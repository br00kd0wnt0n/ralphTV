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

      // Clear canvas
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw channel labels
      ctx.fillStyle = '#00ff00';
      ctx.font = '12px "MS Sans Serif", sans-serif';
      ctx.fillText('L', 5, 15);
      ctx.fillText('R', 5, 35);

      // Draw left channel meter
      const leftWidth = leftVolume * (canvas.width - 25);
      const leftGradient = ctx.createLinearGradient(20, 0, canvas.width - 5, 0);
      leftGradient.addColorStop(0, '#00ff00');
      leftGradient.addColorStop(0.7, '#ffff00');
      leftGradient.addColorStop(0.9, '#ff8800');
      leftGradient.addColorStop(1, '#ff0000');

      ctx.fillStyle = leftGradient;
      ctx.fillRect(20, 5, leftWidth, 12);

      // Draw left channel border
      ctx.strokeStyle = '#00ff00';
      ctx.strokeRect(20, 5, canvas.width - 25, 12);

      // Draw right channel meter
      const rightWidth = rightVolume * (canvas.width - 25);
      const rightGradient = ctx.createLinearGradient(20, 0, canvas.width - 5, 0);
      rightGradient.addColorStop(0, '#00ff00');
      rightGradient.addColorStop(0.7, '#ffff00');
      rightGradient.addColorStop(0.9, '#ff8800');
      rightGradient.addColorStop(1, '#ff0000');

      ctx.fillStyle = rightGradient;
      ctx.fillRect(20, 25, rightWidth, 12);

      // Draw right channel border
      ctx.strokeStyle = '#00ff00';
      ctx.strokeRect(20, 25, canvas.width - 25, 12);

      // Draw peak markers
      for (let i = 0; i < 10; i++) {
        const x = 20 + ((canvas.width - 25) / 10) * i;
        ctx.strokeStyle = '#333333';
        ctx.beginPath();
        ctx.moveTo(x, 5);
        ctx.lineTo(x, 37);
        ctx.stroke();
      }

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
          width={300}
          height={45}
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
