import { useEffect, useRef, useState } from 'react';
import '../styles/volume-visualizer.css';

interface VolumeVisualizerProps {
  audioElement: HTMLVideoElement | HTMLAudioElement | null;
}

export default function VolumeVisualizer({ audioElement }: VolumeVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserLeftRef = useRef<AnalyserNode | null>(null);
  const analyserRightRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) return;

    // Create audio context and analyzers
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaElementSource(audioElement);
    const splitter = audioContext.createChannelSplitter(2);
    const analyserLeft = audioContext.createAnalyser();
    const analyserRight = audioContext.createAnalyser();

    analyserLeft.fftSize = 256;
    analyserRight.fftSize = 256;
    analyserLeft.smoothingTimeConstant = 0.8;
    analyserRight.smoothingTimeConstant = 0.8;

    // Connect: source -> splitter -> analyzers
    source.connect(splitter);
    splitter.connect(analyserLeft, 0); // Left channel
    splitter.connect(analyserRight, 1); // Right channel

    // Also connect to destination so audio plays
    source.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserLeftRef.current = analyserLeft;
    analyserRightRef.current = analyserRight;
    splitterRef.current = splitter;
    setIsActive(true);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
    };
  }, [audioElement]);

  useEffect(() => {
    if (!isActive || !canvasRef.current || !analyserLeftRef.current || !analyserRightRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserLeftRef.current.frequencyBinCount;
    const dataArrayLeft = new Uint8Array(bufferLength);
    const dataArrayRight = new Uint8Array(bufferLength);

    const draw = () => {
      if (!analyserLeftRef.current || !analyserRightRef.current) return;

      analyserLeftRef.current.getByteFrequencyData(dataArrayLeft);
      analyserRightRef.current.getByteFrequencyData(dataArrayRight);

      // Calculate average volume for each channel
      const leftVolume = dataArrayLeft.reduce((a, b) => a + b, 0) / bufferLength / 255;
      const rightVolume = dataArrayRight.reduce((a, b) => a + b, 0) / bufferLength / 255;

      // Clear canvas with dark background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = 40;
      const barHeight = canvas.height - 40;
      const leftX = 30;
      const rightX = canvas.width - leftX - barWidth;
      const barY = 20;

      // Draw vertical meter backgrounds (borders)
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.strokeRect(leftX, barY, barWidth, barHeight);
      ctx.strokeRect(rightX, barY, barWidth, barHeight);

      // Draw left channel vertical meter
      const leftHeight = leftVolume * barHeight;
      const leftGradient = ctx.createLinearGradient(0, barY + barHeight, 0, barY);
      leftGradient.addColorStop(0, '#00ff00');
      leftGradient.addColorStop(0.5, '#ffff00');
      leftGradient.addColorStop(0.8, '#ff8800');
      leftGradient.addColorStop(1, '#ff0000');

      ctx.fillStyle = leftGradient;
      ctx.fillRect(leftX + 1, barY + barHeight - leftHeight, barWidth - 2, leftHeight);

      // Draw right channel vertical meter
      const rightHeight = rightVolume * barHeight;
      const rightGradient = ctx.createLinearGradient(0, barY + barHeight, 0, barY);
      rightGradient.addColorStop(0, '#00ff00');
      rightGradient.addColorStop(0.5, '#ffff00');
      rightGradient.addColorStop(0.8, '#ff8800');
      rightGradient.addColorStop(1, '#ff0000');

      ctx.fillStyle = rightGradient;
      ctx.fillRect(rightX + 1, barY + barHeight - rightHeight, barWidth - 2, rightHeight);

      // Draw level markers
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const y = barY + (barHeight / 10) * i;
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(leftX + barWidth, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rightX, y);
        ctx.lineTo(rightX + barWidth, y);
        ctx.stroke();
      }

      // Draw channel labels at bottom
      ctx.fillStyle = '#b0b0b0';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('L', leftX + barWidth / 2, canvas.height - 5);
      ctx.fillText('R', rightX + barWidth / 2, canvas.height - 5);

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive]);

  return (
    <div className="volume-visualizer-container">
      <div className="volume-visualizer-header">
        <h4>Volume Meters</h4>
      </div>
      <div className="volume-visualizer-canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={200}
          height={200}
          className="volume-visualizer-canvas"
        />
        {!isActive && (
          <div className="volume-visualizer-inactive">
            Waiting for audio...
          </div>
        )}
      </div>
    </div>
  );
}
