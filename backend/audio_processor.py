import numpy as np
import librosa

class AudioProcessor:
    def __init__(self):
        pass

    def load_audio(self, file_path_or_file, sr=22050):
        """
        Load an audio file and return the waveform and sampling rate.
        Supports both file paths and file-like objects (bytes).
        """
        y, sr = librosa.load(file_path_or_file, sr=sr)
        return y, sr

    def get_waveform_data(self, y, sr):
        """
        Process the audio to get data suitable for frontend display if needed,
        though wavesurfer handles raw blobs well. 
        Here we might just return metadata.
        """
        duration = librosa.get_duration(y=y, sr=sr)
        return {
            "duration": duration,
            "sample_rate": sr,
            # "peaks": ... # Wavesurfer can calculate peaks on client side usually
        }

    def detect_beats(self, y, sr):
        """
        Detect beat frames and return their timestamps.
        """
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        
        # Ensure tempo is a standard float, not a numpy type
        if isinstance(tempo, np.ndarray):
            tempo = float(tempo.item())
        else:
            tempo = float(tempo)

        return {
            "tempo": tempo,
            "beat_times": beat_times.tolist(), # Convert numpy array to list for JSON serialization
            "beat_frames": beat_frames.tolist()
        }

