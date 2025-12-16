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

  // Track states
  audioEnded: boolean[] = [];
  trackDurations: number[] = []; // [video_duration, audio1_duration, audio2_duration, ...]

  // Custom controls
  isPlaying = false;
  currentTime = 0;
  videoDuration = 0;
  volume = 1;
  isMuted = false;

  ngAfterViewInit(): void {
    this.initializeTimeline();
  }

  onVideoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedVideo = input.files[0];
      this.trackDurations = [0]; // Initialize with video duration placeholder
      this.setupVideoPlayback();
    }
  }

  onAudioSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.selectedAudios = Array.from(input.files);
      this.mutedTracks = new Array(this.selectedAudios.length).fill(false);
      this.audioEnded = new Array(this.selectedAudios.length).fill(false);
      // Initialize track durations for audio files (will be updated when metadata loads)
      const existingVideoDuration = this.trackDurations[0] || 0;
      this.trackDurations = [existingVideoDuration, ...new Array(this.selectedAudios.length).fill(0)];
      this.setupAudioPlayback();
    }
  }

  removeAudioTrack(index: number): void {
    this.selectedAudios.splice(index, 1);
    this.audioWaveformData.splice(index, 1);
    this.mutedTracks.splice(index, 1);
    this.audioEnded.splice(index, 1);
    this.trackDurations.splice(index + 1, 1); // Remove audio duration (index + 1 because 0 is video)
    this.setupAudioPlayback();
    this.updateMaxTimelineDuration();
    this.updateTimeline();
  }

  // Custom control methods
  togglePlayPause(): void {
    if (!this.videoElement) return;

    const video = this.videoElement.nativeElement;
    if (this.isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  }

  onSeek(event: Event): void {
    if (!this.videoElement) return;

    const target = event.target as HTMLInputElement;
    const seekTime = parseFloat(target.value);
    const video = this.videoElement.nativeElement;

    video.currentTime = seekTime;
    this.currentTime = seekTime;

    // Seek all audio tracks to the same position
    this.audioElements.forEach(audio => {
      if (audio.duration && seekTime <= audio.duration) {
        audio.currentTime = seekTime;
      }
    });
  }

  toggleMute(): void {
    if (!this.videoElement) return;

    const video = this.videoElement.nativeElement;
    this.isMuted = !this.isMuted;
    video.muted = this.isMuted;
  }

  onVolumeChange(event: Event): void {
    if (!this.videoElement) return;

    const target = event.target as HTMLInputElement;
    const newVolume = parseFloat(target.value);

    this.volume = newVolume;
    this.isMuted = newVolume === 0;

    const video = this.videoElement.nativeElement;
    video.volume = newVolume;
    video.muted = this.isMuted;
  }

  formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  toggleAudioMute(index: number): void {
    this.mutedTracks[index] = !this.mutedTracks[index];
    if (this.audioElements[index]) {
      this.audioElements[index].muted = this.mutedTracks[index];
    }
  }


  private initializeTimeline(): void {
    // Initialize with a default 60-second timeline
    this.timelineDuration = 60;
    this.timeMarkers = [];
    for (let i = 0; i <= 60; i += 5) {
      this.timeMarkers.push(this.formatTime(i));
    }
  }

  private setupVideoPlayback(): void {
    if (this.selectedVideo && this.videoElement) {
      const video = this.videoElement.nativeElement;
      const videoUrl = URL.createObjectURL(this.selectedVideo);
      video.src = videoUrl;

      video.onloadedmetadata = () => {
        this.trackDurations[0] = video.duration || 60;
        this.updateMaxTimelineDuration();
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

      // Track audio duration when metadata loads
      audio.addEventListener('loadedmetadata', () => {
        this.trackDurations[index + 1] = audio.duration || 0;
        this.updateMaxTimelineDuration();
        this.updateTimeline();
        // Redraw the waveform with the correct duration
        setTimeout(() => this.drawWaveform('audio', index), 100);
      });

      // Handle audio track ending
      audio.addEventListener('ended', () => {
        this.audioEnded[index] = true;
      });

      // Reset ended state when audio starts playing again
      audio.addEventListener('play', () => {
        this.audioEnded[index] = false;
      });

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
    let trackIndex = type === 'video' ? 0 : index + 1;

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

    // Only draw waveform up to the track's actual duration
    const trackDuration = this.trackDurations[trackIndex] || 0;
    const maxSamples = trackDuration > 0 ? Math.floor((trackDuration / this.timelineDuration) * waveformData.length) : waveformData.length;
    const samplesToDraw = Math.min(maxSamples, waveformData.length);

    // Draw waveform
    ctx.beginPath();
    const sliceWidth = width / waveformData.length;

    for (let i = 0; i < samplesToDraw; i++) {
      const x = i * sliceWidth;
      const amplitude = waveformData[i] * (height / 2 - 2);

      if (i === 0) {
        ctx.moveTo(x, centerY - amplitude);
      } else {
        ctx.lineTo(x, centerY - amplitude);
      }
    }

    // Draw bottom half (mirrored)
    for (let i = samplesToDraw - 1; i >= 0; i--) {
      const x = i * sliceWidth;
      const amplitude = waveformData[i] * (height / 2 - 2);
      ctx.lineTo(x, centerY + amplitude);
    }

    ctx.closePath();
    ctx.fillStyle = type === 'video' ? 'rgba(76, 175, 80, 0.3)' : 'rgba(33, 150, 243, 0.3)';
    ctx.fill();
    ctx.stroke();

    // Draw end indicator if track is shorter than timeline
    if (samplesToDraw < waveformData.length) {
      const endX = samplesToDraw * sliceWidth;
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(endX, 0);
      ctx.lineTo(endX, height);
      ctx.stroke();
    }
  }

  private synchronizePlayback(): void {
    if (!this.videoElement || !this.selectedVideo) return;

    const video = this.videoElement.nativeElement;

    // Initialize custom controls
    this.videoDuration = video.duration || 0;
    this.volume = video.volume;
    this.isMuted = video.muted;

    // Start playhead animation
    this.startPlayheadAnimation();

    // Play all tracks simultaneously when video starts
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this.audioElements.forEach((audio, index) => {
        if (!this.mutedTracks[index]) {
          // If audio has ended or hasn't started, start from beginning
          // Otherwise, continue from current position
          if (audio.ended || audio.currentTime === 0) {
            audio.currentTime = 0;
          }
          audio.play().catch(error => {
            console.log('Audio play failed:', error);
          });
        }
      });
    });

    // Pause all tracks when video pauses
    video.addEventListener('pause', () => {
      this.isPlaying = false;
      this.audioElements.forEach(audio => audio.pause());
    });

    // Stop all tracks when video ends
    video.addEventListener('ended', () => {
      this.isPlaying = false;
      this.audioElements.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
      });
    });

    // Handle seeking - only seek audio tracks that have enough duration
    video.addEventListener('seeked', () => {
      const targetTime = video.currentTime;
      this.audioElements.forEach(audio => {
        // Only seek if the audio track is long enough for the target time
        if (audio.duration && targetTime <= audio.duration) {
          audio.currentTime = targetTime;
        } else if (targetTime > audio.duration) {
          // If seeking beyond audio duration, pause it or let it end naturally
          audio.pause();
        }
      });
    });

    // Update playhead position and custom controls
    video.addEventListener('timeupdate', () => {
      this.currentTime = video.currentTime;
      this.updatePlayheadPosition();
    });

    // Update duration when metadata loads
    video.addEventListener('loadedmetadata', () => {
      this.videoDuration = video.duration;
      this.volume = video.volume;
      this.isMuted = video.muted;
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

  private updateMaxTimelineDuration(): void {
    // Set timeline duration to the maximum duration across all tracks
    this.timelineDuration = Math.max(...this.trackDurations, 60); // Minimum 60 seconds
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
