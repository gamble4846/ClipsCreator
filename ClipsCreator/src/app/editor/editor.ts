import { Component, ElementRef, ViewChild, QueryList, ViewChildren, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-editor',
  imports: [CommonModule],
  templateUrl: './editor.html',
  styleUrl: './editor.css',
})
export class Editor implements AfterViewInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChildren('videoCanvas') videoCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChildren('audioCanvas') audioCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  selectedVideo: File | null = null;
  selectedAudios: File[] = [];
  private audioElements: HTMLAudioElement[] = [];
  private audioContexts: AudioContext[] = [];
  private animationFrameId: number | null = null;

  // Timeline and playhead
  playheadPosition = 0;
  timeMarkers: string[] = [];
  timelineDuration = 0;
  mutedTracks: boolean[] = [];

  // Waveform data
  videoWaveformData: number[] = [];
  audioWaveformData: number[][] = [];

  ngAfterViewInit(): void {
    this.initializeTimeline();
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedVideo = input.files[0];
      this.setupVideoPlayback();
    }
  }

  onAudioSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.selectedAudios = Array.from(input.files);
      this.mutedTracks = new Array(this.selectedAudios.length).fill(false);
      this.setupAudioPlayback();
    }
  }

  removeAudioTrack(index: number): void {
    this.selectedAudios.splice(index, 1);
    this.audioWaveformData.splice(index, 1);
    this.mutedTracks.splice(index, 1);
    this.setupAudioPlayback();
    this.updateTimeline();
  }

  toggleMute(index: number): void {
    this.mutedTracks[index] = !this.mutedTracks[index];
    if (this.audioElements[index]) {
      this.audioElements[index].muted = this.mutedTracks[index];
    }
  }

  private initializeTimeline(): void {
    this.timeMarkers = [];
    for (let i = 0; i <= 60; i += 5) {
      this.timeMarkers.push(this.formatTime(i));
    }
  }

  private formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private setupVideoPlayback(): void {
    if (this.selectedVideo && this.videoElement) {
      const video = this.videoElement.nativeElement;
      const videoUrl = URL.createObjectURL(this.selectedVideo);
      video.src = videoUrl;

      video.onloadedmetadata = () => {
        this.timelineDuration = video.duration || 60;
        this.generateVideoWaveform();
        this.updateTimeline();
        this.synchronizePlayback();
      };
    }
  }

  private setupAudioPlayback(): void {
    // Clean up existing audio elements and contexts
    this.audioElements.forEach(audio => {
      audio.pause();
      audio.remove();
    });
    this.audioContexts.forEach(context => context.close());
    this.audioElements = [];
    this.audioContexts = [];
    this.audioWaveformData = [];

    // Create new audio elements and generate waveforms
    this.selectedAudios.forEach((audioFile, index) => {
      const audio = new Audio(URL.createObjectURL(audioFile));
      audio.preload = 'metadata';
      this.audioElements.push(audio);

      // Generate waveform for this audio file
      this.generateAudioWaveform(audioFile, index);
    });

    if (this.selectedVideo && this.videoElement) {
      this.synchronizePlayback();
    }
  }

  private async generateVideoWaveform(): Promise<void> {
    if (!this.selectedVideo) return;

    // For video, we'll create a simple placeholder waveform
    // In a real application, you'd extract audio from video and analyze it
    this.videoWaveformData = Array.from({ length: 200 }, () =>
      Math.random() * 0.8 + 0.2
    );

    setTimeout(() => this.drawWaveform('video', 0), 100);
  }

  private async generateAudioWaveform(audioFile: File, index: number): Promise<void> {
    try {
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioContext = new AudioContext();
      this.audioContexts.push(audioContext);

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);

      // Downsample for performance
      const samples = 200;
      const blockSize = Math.floor(channelData.length / samples);
      const waveformData: number[] = [];

      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[start + j]);
        }
        waveformData.push(sum / blockSize);
      }

      this.audioWaveformData[index] = waveformData;
      setTimeout(() => this.drawWaveform('audio', index), 100);
    } catch (error) {
      console.error('Error generating waveform:', error);
      // Fallback to random waveform
      this.audioWaveformData[index] = Array.from({ length: 200 }, () =>
        Math.random() * 0.8 + 0.2
      );
      setTimeout(() => this.drawWaveform('audio', index), 100);
    }
  }

  private drawWaveform(type: 'video' | 'audio', index: number): void {
    let canvas: HTMLCanvasElement;
    let waveformData: number[];

    if (type === 'video') {
      const videoCanvases = Array.from(this.videoCanvases);
      if (videoCanvases.length === 0) return;
      canvas = videoCanvases[0].nativeElement;
      waveformData = this.videoWaveformData;
    } else {
      const audioCanvases = Array.from(this.audioCanvases);
      if (audioCanvases.length <= index) return;
      canvas = audioCanvases[index].nativeElement;
      waveformData = this.audioWaveformData[index] || [];
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set waveform color
    ctx.strokeStyle = type === 'video' ? '#4CAF50' : '#2196F3';
    ctx.lineWidth = 1;

    // Draw waveform
    ctx.beginPath();
    const sliceWidth = width / waveformData.length;

    for (let i = 0; i < waveformData.length; i++) {
      const x = i * sliceWidth;
      const amplitude = waveformData[i] * (height / 2 - 2);

      if (i === 0) {
        ctx.moveTo(x, centerY - amplitude);
      } else {
        ctx.lineTo(x, centerY - amplitude);
      }
    }

    // Draw bottom half (mirrored)
    for (let i = waveformData.length - 1; i >= 0; i--) {
      const x = i * sliceWidth;
      const amplitude = waveformData[i] * (height / 2 - 2);
      ctx.lineTo(x, centerY + amplitude);
    }

    ctx.closePath();
    ctx.fillStyle = type === 'video' ? 'rgba(76, 175, 80, 0.3)' : 'rgba(33, 150, 243, 0.3)';
    ctx.fill();
    ctx.stroke();
  }

  private synchronizePlayback(): void {
    if (!this.videoElement || !this.selectedVideo) return;

    const video = this.videoElement.nativeElement;

    // Start playhead animation
    this.startPlayheadAnimation();

    // Synchronize audio playback with video
    const syncAudio = () => {
      const currentTime = video.currentTime;
      this.audioElements.forEach(audio => {
        if (Math.abs(audio.currentTime - currentTime) > 0.1) {
          audio.currentTime = currentTime;
        }
      });
    };

    // Add event listeners for synchronization
    video.addEventListener('play', () => {
      this.audioElements.forEach((audio, index) => {
        if (!this.mutedTracks[index]) {
          audio.play();
        }
      });
    });

    video.addEventListener('pause', () => {
      this.audioElements.forEach(audio => audio.pause());
    });

    video.addEventListener('seeked', syncAudio);
    video.addEventListener('timeupdate', () => {
      this.updatePlayheadPosition();
      // Less frequent sync to avoid performance issues
      if (video.currentTime % 0.5 < 0.1) {
        syncAudio();
      }
    });
  }

  private startPlayheadAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const animate = () => {
      this.updatePlayheadPosition();
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  private updatePlayheadPosition(): void {
    if (!this.videoElement) return;

    const video = this.videoElement.nativeElement;
    const progress = (video.currentTime / this.timelineDuration) * 100;
    this.playheadPosition = Math.min(progress, 100);
  }

  private updateTimeline(): void {
    // Update time markers based on duration
    this.timeMarkers = [];
    const markerCount = 12;
    const interval = Math.max(5, Math.ceil(this.timelineDuration / markerCount));

    for (let i = 0; i <= this.timelineDuration; i += interval) {
      this.timeMarkers.push(this.formatTime(i));
    }
  }

  ngOnDestroy(): void {
    // Clean up animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Clean up audio contexts
    this.audioContexts.forEach(context => {
      context.close();
    });

    // Clean up object URLs and audio elements
    this.audioElements.forEach(audio => {
      audio.pause();
      audio.remove();
    });

    if (this.selectedVideo && this.videoElement) {
      URL.revokeObjectURL(this.videoElement.nativeElement.src);
    }
  }
}
