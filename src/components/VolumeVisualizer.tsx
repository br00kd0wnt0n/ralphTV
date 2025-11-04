import { useEffect, useRef, useState } from 'react';
import '../styles/volume-visualizer.css';

interface VolumeVisualizerProps {
  audioElement: HTMLVideoElement | HTMLAudioElement | null;
  volume?: number; // 0-1 range for playback volume control
}

export default function VolumeVisualizer({ audioElement, volume = 0.7 }: VolumeVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserLeftRef = useRef<AnalyserNode | null>(null);
  const analyserRightRef = useRef<AnalyserNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!audioElement || !canvasRef.current) {
      console.log('[VolumeVisualizer] Not ready:', { audioElement: !!audioElement, canvas: !!canvasRef.current });
      return;
    }

    console.log('[VolumeVisualizer] Initializing Web Audio API');

    try {
      // Create audio context and analyzers
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      console.log('[VolumeVisualizer] AudioContext state:', audioContext.state);

      // Resume audio context if suspended (common on mobile/browsers)
      const resumeAudioContext = () => {
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            console.log('[VolumeVisualizer] AudioContext resumed from', audioContext.state);
          }).catch((err) => {
            console.error('[VolumeVisualizer] Failed to resume AudioContext:', err);
          });
        }
      };

      // Try to resume immediately
      resumeAudioContext();

      // Also try on next user interaction
      const interactionHandler = () => {
        resumeAudioContext();
        // Only need to do this once
        document.removeEventListener('click', interactionHandler);
        document.removeEventListener('keydown', interactionHandler);
      };
      document.addEventListener('click', interactionHandler);
      document.addEventListener('keydown', interactionHandler);

      // Check if MediaElementSource was already created for this element
      let source;
      try {
        source = audioContext.createMediaElementSource(audioElement);
      } catch (err: any) {
        if (err.name === 'InvalidStateError') {
          console.error('[VolumeVisualizer] MediaElementSource already exists for this element. Cannot create visualizer.');
          setIsActive(false);
          return () => {};
        }
        throw err;
      }
      const splitter = audioContext.createChannelSplitter(2);
      const analyserLeft = audioContext.createAnalyser();
      const analyserRight = audioContext.createAnalyser();
      const gainNode = audioContext.createGain();

      analyserLeft.fftSize = 256;
      analyserRight.fftSize = 256;
      analyserLeft.smoothingTimeConstant = 0.8;
      analyserRight.smoothingTimeConstant = 0.8;
      gainNode.gain.value = volume;

      // Connect: source -> splitter -> analyzers (for visualization - reads original levels)
      source.connect(splitter);
      splitter.connect(analyserLeft, 0); // Left channel
      splitter.connect(analyserRight, 1); // Right channel

      // Connect: source -> gainNode -> destination (for playback with volume control)
      source.connect(gainNode);
      gainNode.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      analyserLeftRef.current = analyserLeft;
      analyserRightRef.current = analyserRight;
      splitterRef.current = splitter;
      gainNodeRef.current = gainNode;
      setIsActive(true);

      console.log('[VolumeVisualizer] Web Audio API initialized successfully');

      // Store interaction handler for cleanup
      return () => {
        document.removeEventListener('click', interactionHandler);
        document.removeEventListener('keydown', interactionHandler);
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
        }
      };
    } catch (error) {
      console.error('[VolumeVisualizer] Failed to initialize Web Audio API:', error);
      setIsActive(false);
      return () => {};
    }
  }, [audioElement]);

  // Update gain when volume prop changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

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

    let frameCount = 0;
    const draw = () => {
      if (!analyserLeftRef.current || !analyserRightRef.current) return;

      analyserLeftRef.current.getByteFrequencyData(dataArrayLeft);
      analyserRightRef.current.getByteFrequencyData(dataArrayRight);

      // Calculate average volume for each channel
      const leftVolume = dataArrayLeft.reduce((a, b) => a + b, 0) / bufferLength / 255;
      const rightVolume = dataArrayRight.reduce((a, b) => a + b, 0) / bufferLength / 255;

      // Debug log every 60 frames (roughly once per second at 60fps)
      if (frameCount++ % 60 === 0) {
        console.log('[VolumeVisualizer] Audio levels:', {
          left: leftVolume.toFixed(3),
          right: rightVolume.toFixed(3),
          audioContextState: audioContextRef.current?.state
        });
      }

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

  // Click handler to resume audio context if suspended
  const handleClick = () => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      console.log('[VolumeVisualizer] Resuming AudioContext from user click');
      audioContextRef.current.resume();
    }
  };

  return (
    <div className="volume-visualizer-container">
      <div className="volume-visualizer-header">
        <h4>Volume Meters</h4>
      </div>
      <div className="volume-visualizer-canvas-wrapper" onClick={handleClick}>
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
