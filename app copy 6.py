import os
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_restful import Resource, Api
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pydub import AudioSegment
# Updated MoviePy imports for version 2.2.1
from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.VideoClip import ColorClip, TextClip, ImageClip # Common location for these base clips
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
import logging
import numpy as np
from PIL import Image, ImageDraw
import shutil # For cleaning up temp directories
import matplotlib
matplotlib.use('Agg') # Use 'Agg' backend for non-interactive plotting (important for server environments)
import matplotlib.pyplot as plt
from matplotlib.patches import Circle

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
api = Api(app)
CORS(app) # Enable CORS for all routes

# Configuration
UPLOAD_FOLDER = 'uploads'
GENERATED_FILES_FOLDER = 'generated_files'
TEMP_FRAMES_FOLDER = 'temp_frames' # New folder for waveform frames
ALLOWED_AUDIO_EXTENSIONS = {'wav', 'mp3', 'webm', 'ogg', 'aac'}
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['GENERATED_FILES_FOLDER'] = GENERATED_FILES_FOLDER
app.config['TEMP_FRAMES_FOLDER'] = TEMP_FRAMES_FOLDER

# Define a constant for background audio volume (in dB)
# A negative value means quieter. -20 dB should make it significantly lower.
BACKGROUND_AUDIO_VOLUME_DB = -20

# Define a constant to control the amplitude of the waveform visualization
# Increase this value to make the waveform peaks higher.
WAVEFORM_AMPLITUDE_MULTIPLIER = 1.5 

# Create necessary directories if they don't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(GENERATED_FILES_FOLDER, exist_ok=True)
os.makedirs(TEMP_FRAMES_FOLDER, exist_ok=True)

def allowed_file(filename, allowed_extensions):
    """Checks if a filename has an allowed extension."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in allowed_extensions

def validate_color(color_hex):
    """Validates if a string is a valid hex color code."""
    if not isinstance(color_hex, str) or not color_hex.startswith('#'):
        return False
    # Check for 3-digit or 6-digit hex
    hex_value = color_hex[1:]
    return len(hex_value) in (3, 6) and all(c in '0123456789abcdefABCDEF' for c in hex_value)

def validate_float_range(value, min_val, max_val):
    """Validates if a value is a float within a specified range."""
    try:
        f_val = float(value)
        return min_val <= f_val <= max_val
    except (ValueError, TypeError):
        return False

def hex_to_rgb(hex_color):
    """Converts a hex color string to an RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def generate_waveform_frames(audio_filepath, video_duration, fps, video_width, video_height, waveform_style, waveform_color_hex, temp_dir):
    """Generates a sequence of waveform image frames using Matplotlib."""
    logging.info(f"Generating waveform frames for {audio_filepath} with style {waveform_style}")
    
    try:
        audio = AudioSegment.from_file(audio_filepath)
        # Convert to raw audio data (mono for simpler visualization)
        audio_data = np.array(audio.get_array_of_samples())
        if audio.channels > 1:
            # Simple mono conversion: average channels
            audio_data = audio_data.reshape((-1, audio.channels)).mean(axis=1)

        # Calculate total samples and samples per frame
        total_samples = len(audio_data)
        samples_per_frame = int(audio.frame_rate / fps)
        num_frames = int(video_duration * fps)

        frame_paths = []
        # Use global max amplitude for consistent scaling across all frames
        global_max_amplitude = np.max(np.abs(audio_data))
        if global_max_amplitude == 0: global_max_amplitude = 1 # Avoid division by zero

        for i in range(num_frames):
            start_sample = i * samples_per_frame
            end_sample = start_sample + samples_per_frame
            
            # Ensure we don't go out of bounds for the current frame's audio data
            current_frame_audio_data = audio_data[start_sample:min(end_sample, total_samples)]
            
            # Create a new matplotlib figure for each frame
            fig, ax = plt.subplots(figsize=(video_width / 100, video_height / 100), dpi=100) # Adjust figsize based on desired output resolution
            
            # Set background to transparent
            fig.patch.set_alpha(0.0)
            ax.patch.set_alpha(0.0)

            # Remove axes, ticks, labels, and padding
            ax.set_axis_off()
            ax.margins(0,0)
            ax.set_frame_on(False)
            ax.set_xlim(0, video_width / 100) # Set x-limits to match figsize units
            ax.set_ylim(-video_height / 200, video_height / 200) # Set y-limits to center waveform

            if len(current_frame_audio_data) > 0:
                # Normalize amplitude to a suitable range for plotting (e.g., -1 to 1 or 0 to 1)
                normalized_amplitudes_plot = current_frame_audio_data / global_max_amplitude

                if waveform_style == 'bars' or waveform_style == 'frequency-bars':
                    # For bars, we can use a simplified representation of frequency or just amplitude bars
                    # Let's use amplitude bars for simplicity and visual appeal
                    num_bars = 100 # Number of bars to display
                    bar_indices = np.linspace(0, len(normalized_amplitudes_plot) - 1, num_bars, dtype=int)
                    bar_heights = normalized_amplitudes_plot[bar_indices]
                    
                    x_positions = np.linspace(0, video_width / 100, num_bars)
                    ax.bar(x_positions, bar_heights * (video_height / 200) * WAVEFORM_AMPLITUDE_MULTIPLIER, width=(video_width / 100) / num_bars * 0.8, 
                           color=waveform_color_hex, align='center', bottom=0)
                    ax.bar(x_positions, bar_heights * (-video_height / 200) * WAVEFORM_AMPLITUDE_MULTIPLIER, width=(video_width / 100) / num_bars * 0.8, 
                           color=waveform_color_hex, align='center', bottom=0) # Mirror for centered effect

                elif waveform_style == 'lines' or waveform_style == 'smooth-lines':
                    x_positions = np.linspace(0, video_width / 100, len(normalized_amplitudes_plot))
                    ax.plot(x_positions, normalized_amplitudes_plot * (video_height / 200) * WAVEFORM_AMPLITUDE_MULTIPLIER, 
                            color=waveform_color_hex, linewidth=2)
                elif waveform_style == 'circles':
                    # Represent as a pulsating circle based on RMS amplitude
                    rms_amplitude = np.sqrt(np.mean(normalized_amplitudes_plot**2))
                    max_radius = min(video_width, video_height) / 400 # Max radius relative to video size
                    current_radius = rms_amplitude * max_radius * WAVEFORM_AMPLITUDE_MULTIPLIER
                    
                    circle = Circle((video_width / 200, video_height / 200), current_radius, 
                                    color=waveform_color_hex, fill=False, linewidth=3)
                    ax.add_patch(circle)
                    ax.set_xlim(0, video_width / 100)
                    ax.set_ylim(0, video_height / 100)
                    ax.set_aspect('equal', adjustable='box') # Ensure circle is round
                else:
                    # Default to lines if style is unknown
                    x_positions = np.linspace(0, video_width / 100, len(normalized_amplitudes_plot))
                    ax.plot(x_positions, normalized_amplitudes_plot * (video_height / 200) * WAVEFORM_AMPLITUDE_MULTIPLIER, 
                            color=waveform_color_hex, linewidth=2)

            frame_path = os.path.join(temp_dir, f"frame_{i:05d}.png")
            plt.savefig(frame_path, transparent=True, bbox_inches='tight', pad_inches=0)
            plt.close(fig) # Close the figure to free memory
            frame_paths.append(frame_path)
        
        logging.info(f"Generated {len(frame_paths)} waveform frames.")
        return frame_paths

    except Exception as e:
        logging.error(f"Error generating waveform frames: {e}", exc_info=True)
        raise

class PodcastGenerate(Resource):
    def post(self):
        logging.info("Received request for podcast generation.")

        uploaded_audio_file = request.files.get('uploadedAudio')
        recorded_audio_file = request.files.get('recordedAudio')

        final_audio_segment = None
        temp_audio_filepath = None

        uploaded_audio_path = None
        recorded_audio_path = None

        try:
            # --- Handle Uploaded Audio ---
            if uploaded_audio_file and uploaded_audio_file.filename != '':
                if not allowed_file(uploaded_audio_file.filename, ALLOWED_AUDIO_EXTENSIONS):
                    logging.warning(f"Uploaded audio file extension not allowed: {uploaded_audio_file.filename}")
                    return {'message': 'Uploaded audio file type not allowed'}, 400
                uploaded_audio_filename = secure_filename(uploaded_audio_file.filename)
                uploaded_audio_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{uuid.uuid4()}_{uploaded_audio_filename}")
                uploaded_audio_file.save(uploaded_audio_path)
                logging.info(f"Uploaded audio file saved to: {uploaded_audio_path}")
                
                final_audio_segment = AudioSegment.from_file(uploaded_audio_path)
                # Apply background volume to the uploaded audio
                final_audio_segment = final_audio_segment + BACKGROUND_AUDIO_VOLUME_DB 

            # --- Handle Recorded Audio ---
            if recorded_audio_file and recorded_audio_file.filename != '':
                if not allowed_file(recorded_audio_file.filename, ALLOWED_AUDIO_EXTENSIONS):
                    logging.warning(f"Recorded audio file extension not allowed: {recorded_audio_file.filename}")
                    return {'message': 'Recorded audio file type not allowed'}, 400
                recorded_audio_filename = secure_filename(recorded_audio_file.filename)
                recorded_audio_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{uuid.uuid4()}_{recorded_audio_filename}")
                recorded_audio_file.save(recorded_audio_path)
                logging.info(f"Recorded audio file saved to: {recorded_audio_path}")
                
                recorded_audio_segment = AudioSegment.from_file(recorded_audio_path)

                if final_audio_segment: # If uploaded audio exists, overlay recorded audio
                    # Extend background audio if recorded audio is longer
                    if len(recorded_audio_segment) > len(final_audio_segment):
                        # Pad final_audio_segment with silence to match recorded audio length
                        silence = AudioSegment.silent(duration=len(recorded_audio_segment) - len(final_audio_segment))
                        final_audio_segment += silence
                    
                    final_audio_segment = final_audio_segment.overlay(recorded_audio_segment, position=0)
                else: # Only recorded audio provided
                    final_audio_segment = recorded_audio_segment
            
            if final_audio_segment is None:
                logging.warning("No audio files provided for video generation.")
                return {'message': 'No audio files provided'}, 400

            # Export the merged/single audio segment to a temporary file for MoviePy
            temp_audio_filename = f"merged_audio_{uuid.uuid4()}.mp3" # Using MP3 for broader compatibility
            temp_audio_filepath = os.path.join(app.config['UPLOAD_FOLDER'], temp_audio_filename)
            final_audio_segment.export(temp_audio_filepath, format="mp3")
            logging.info(f"Final audio segment exported to: {temp_audio_filepath}")

            # Extract and validate other parameters
            waveform_style = request.form.get('waveformStyle')
            waveform_color = request.form.get('waveformColor')
            background_color_hex = request.form.get('backgroundColor')
            background_opacity_str = request.form.get('backgroundOpacity')
            playback_speed_str = request.form.get('playbackSpeed')
            text_overlay = request.form.get('textOverlay', '')
            audio_output_format = request.form.get('downloadFormat', 'mp3').lower() 

            # Basic validation for other fields
            if waveform_style not in ['bars', 'lines', 'circles', 'frequency-bars', 'smooth-lines']:
                logging.warning(f"Invalid waveform style: {waveform_style}")
                return {'message': 'Invalid waveform style'}, 400
            if not validate_color(waveform_color):
                logging.warning(f"Invalid waveform color: {waveform_color}")
                return {'message': 'Invalid waveform color format'}, 400
            if not validate_color(background_color_hex):
                logging.warning(f"Invalid background color: {background_color_hex}")
                return {'message': 'Invalid background color format'}, 400
            if not validate_float_range(background_opacity_str, 0.0, 1.0):
                logging.warning(f"Invalid background opacity: {background_opacity_str}")
                return {'message': 'Invalid background opacity value (must be between 0 and 1)'}, 400
            if not validate_float_range(playback_speed_str, 0.1, 5.0): # Assuming reasonable speed range
                logging.warning(f"Invalid playback speed: {playback_speed_str}")
                return {'message': 'Invalid playback speed value'}, 400
            if audio_output_format not in ['webm', 'wav', 'mp3', 'aac']: # Added aac as a common video audio codec
                logging.warning(f"Invalid audio output format for video: {audio_output_format}")
                return {'message': 'Invalid audio output format for video'}, 400

            background_opacity = float(background_opacity_str)
            playback_speed = float(playback_speed_str)

            # Handle background image
            background_image_file = request.files.get('backgroundImage')
            background_image_filepath = None
            if background_image_file and background_image_file.filename != '':
                if not allowed_file(background_image_file.filename, ALLOWED_IMAGE_EXTENSIONS):
                    logging.warning(f"Background image extension not allowed: {background_image_file.filename}")
                    return {'message': 'Background image file type not allowed'}, 400
                bg_image_filename = secure_filename(background_image_file.filename)
                unique_bg_image_filename = f"{uuid.uuid4()}_{bg_image_filename}"
                background_image_filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_bg_image_filename)
                background_image_file.save(background_image_filepath)
                logging.info(f"Background image saved to: {background_image_filepath}")

            output_video_filename = f"waveform_video_{uuid.uuid4()}.mp4" # Always output MP4 video
            output_video_filepath = os.path.join(app.config['GENERATED_FILES_FOLDER'], output_video_filename)

            temp_frames_dir = os.path.join(app.config['TEMP_FRAMES_FOLDER'], str(uuid.uuid4()))
            os.makedirs(temp_frames_dir, exist_ok=True)

            # 1. Load the merged audio clip using MoviePy
            audio_clip = AudioFileClip(temp_audio_filepath)
            
            # Apply playback speed to audio clip (already applied to pydub segment, but good to keep consistency)
            # MoviePy's speedx might re-encode, so it's better to do it once with pydub
            # audio_clip = audio_clip.speedx(playback_speed) # Removed as speed is handled by pydub now

            # Define video dimensions and FPS
            video_width, video_height = 1280, 720 
            video_fps = 24 # Standard video FPS

            # 2. Generate waveform frames from the *merged* audio
            waveform_frame_paths = generate_waveform_frames(
                temp_audio_filepath, audio_clip.duration, video_fps, 
                video_width, video_height, waveform_style, waveform_color, temp_frames_dir
            )
            waveform_clip = ImageSequenceClip(waveform_frame_paths, fps=video_fps)

            # 3. Create the background video clip
            if background_image_filepath:
                background_clip = ImageClip(background_image_filepath).with_duration(audio_clip.duration)
                background_clip = background_clip.resized((video_width, video_height)) 
            else:
                rgb_color = hex_to_rgb(background_color_hex)
                background_clip = ColorClip(size=(video_width, video_height), 
                                            color=rgb_color, 
                                            duration=audio_clip.duration)
                # For opacity, MoviePy handles it when compositing if the top layer has alpha.
                # If background_clip itself needs opacity, it would be done via compositing with another video.
                # For a solid color background, opacity is less relevant unless compositing with another video.

            # 4. Create the text overlay clip
            all_clips = [background_clip, waveform_clip]
            if text_overlay:
                text_clip = TextClip(text_overlay, 
                                     fontsize=50, 
                                     color='white', 
                                     # Removed 'font' argument to avoid TypeError
                                     stroke_color='black',
                                     stroke_width=1
                                     # Removed bg_color='transparent' as it causes error
                                     )
                # Updated syntax for moviepy 2.2.1
                text_clip = text_clip.with_position(('center', 0.05)).with_duration(audio_clip.duration)
                all_clips.append(text_clip)
                
            # Composite all clips
            final_video_clip = CompositeVideoClip(all_clips, size=(video_width, video_height))

            # 5. Set the audio of the final video clip
            final_video_clip = final_video_clip.with_audio(audio_clip)

            # 6. Write the final video file
            # Use 'libx264' for video codec and 'aac' for audio codec for MP4
            final_video_clip.write_videofile(output_video_filepath, 
                                            fps=video_fps, 
                                            codec='libx264', 
                                            audio_codec='aac',
                                            threads=4) # Use multiple threads for faster encoding
            logging.info(f"Video generated successfully: {output_video_filepath}")
            
            # Construct the URL for download
            video_url = f"/api/v2/podcast/download/{os.path.basename(output_video_filepath)}"
            logging.info(f"Generated video download URL: {video_url}")

            # Updated return statement as per user's request
            return {'message': 'Video generated successfully', 'video_url': video_url}, 200

        except Exception as e:
            logging.error(f"Error during video generation: {e}", exc_info=True)
            # Check for FFmpeg specific errors
            if "ffmpeg" in str(e).lower() and "not found" in str(e).lower():
                error_message = "FFmpeg is not installed or not accessible in your system's PATH. Please install FFmpeg."
            else:
                error_message = f'Video generation failed: {str(e)}.'
            return {'message': error_message}, 500
        finally:
            # Clean up uploaded files and temporary frames
            if uploaded_audio_path and os.path.exists(uploaded_audio_path):
                os.remove(uploaded_audio_path)
                logging.info(f"Cleaned up uploaded audio: {uploaded_audio_path}")
            if recorded_audio_path and os.path.exists(recorded_audio_path):
                os.remove(recorded_audio_path)
                logging.info(f"Cleaned up recorded audio: {recorded_audio_path}")
            if temp_audio_filepath and os.path.exists(temp_audio_filepath):
                os.remove(temp_audio_filepath)
                logging.info(f"Cleaned up temporary merged audio: {temp_audio_filepath}")
            if os.path.exists(temp_frames_dir):
                shutil.rmtree(temp_frames_dir)
                logging.info(f"Cleaned up temporary frames directory: {temp_frames_dir}")

class DownloadFile(Resource):
    def get(self, filename):
        logging.info(f"Received download request for: {filename}")
        try:
            return send_from_directory(app.config['GENERATED_FILES_FOLDER'], filename, as_attachment=True)
        except FileNotFoundError:
            logging.warning(f"File not found for download: {filename}")
            return {'message': 'File not found'}, 404
        except Exception as e:
            logging.error(f"Error serving file {filename} for download: {e}", exc_info=True)
            return {'message': f'Error serving file: {str(e)}'}, 500

api.add_resource(PodcastGenerate, '/api/v2/podcast/generate')
api.add_resource(DownloadFile, '/api/v2/podcast/download/<string:filename>')

if __name__ == '__main__':
    # For local development, run with debug=True
    # In production, use a production-ready WSGI server like Gunicorn or uWSGI
    app.run(debug=True, host='0.0.0.0', port=5000)
