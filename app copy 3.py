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
    """Generates a sequence of waveform image frames."""
    logging.info(f"Generating waveform frames for {audio_filepath} with style {waveform_style}")
    waveform_color_rgb = hex_to_rgb(waveform_color_hex)
    
    try:
        audio = AudioSegment.from_file(audio_filepath)
        # Convert to raw audio data (mono for simpler visualization)
        audio_data = np.array(audio.get_array_of_samples())
        if audio.channels > 1:
            # Simple mono conversion: average channels
            audio_data = audio_data.reshape((-1, audio.channels)).mean(axis=1)

        samples_per_frame = int(audio.frame_rate / fps)
        num_frames = int(video_duration * fps)

        frame_paths = []
        for i in range(num_frames):
            start_sample = i * samples_per_frame
            end_sample = start_sample + samples_per_frame
            
            # Ensure we don't go out of bounds
            if start_sample >= len(audio_data):
                break
            
            frame_audio_data = audio_data[start_sample:end_sample]
            
            # Create a blank image for the frame
            img = Image.new('RGBA', (video_width, video_height), (0, 0, 0, 0)) # Transparent background
            draw = ImageDraw.Draw(img)

            # Draw waveform based on style
            if len(frame_audio_data) > 0:
                max_amplitude = np.max(np.abs(audio_data)) # Use global max for consistent scaling
                if max_amplitude == 0: max_amplitude = 1 # Avoid division by zero

                # Normalize amplitude to canvas height
                normalized_amplitudes = (np.abs(frame_audio_data) / max_amplitude) * (video_height / 2)

                if waveform_style == 'bars' or waveform_style == 'frequency-bars':
                    bar_width = max(1, video_width // 100) # Adjust bar width dynamically
                    num_bars = video_width // bar_width
                    step = max(1, len(normalized_amplitudes) // num_bars)
                    
                    for j in range(num_bars):
                        if j * step < len(normalized_amplitudes):
                            height_val = normalized_amplitudes[j * step]
                            # Draw bars from center
                            draw.rectangle([j * bar_width, video_height / 2 - height_val, 
                                            (j + 1) * bar_width, video_height / 2 + height_val], 
                                           fill=waveform_color_rgb)
                elif waveform_style == 'lines' or waveform_style == 'smooth-lines':
                    points = []
                    for j, amp in enumerate(normalized_amplitudes):
                        x = (j / len(normalized_amplitudes)) * video_width
                        y = video_height / 2 - amp # Draw from center
                        points.append((x, y))
                        
                        x = (j / len(normalized_amplitudes)) * video_width
                        y = video_height / 2 + amp # Draw from center
                        points.append((x, y))

                    if len(points) > 1:
                        draw.line(points, fill=waveform_color_rgb, width=2)
                elif waveform_style == 'circles':
                    # Simplified circle: radius based on average amplitude
                    avg_amplitude = np.mean(normalized_amplitudes) if len(normalized_amplitudes) > 0 else 0
                    radius = avg_amplitude * 0.5 # Scale down for aesthetics
                    center_x, center_y = video_width / 2, video_height / 2
                    if radius > 0:
                        draw.ellipse([center_x - radius, center_y - radius,
                                      center_x + radius, center_y + radius],
                                     outline=waveform_color_rgb, width=2)
                else:
                    # Fallback for unsupported or complex styles to a simple line
                    points = []
                    for j, amp in enumerate(normalized_amplitudes):
                        x = (j / len(normalized_amplitudes)) * video_width
                        y = video_height / 2 - amp
                        points.append((x, y))
                    if len(points) > 1:
                        draw.line(points, fill=waveform_color_rgb, width=2)

            frame_path = os.path.join(temp_dir, f"frame_{i:05d}.png")
            img.save(frame_path)
            frame_paths.append(frame_path)
        
        logging.info(f"Generated {len(frame_paths)} waveform frames.")
        return frame_paths

    except Exception as e:
        logging.error(f"Error generating waveform frames: {e}", exc_info=True)
        raise

class PodcastGenerate(Resource):
    def post(self):
        logging.info("Received request for podcast generation.")

        # Validate audio file
        if 'audio' not in request.files:
            logging.warning("No audio file part in request.")
            return {'message': 'No audio file provided'}, 400
        audio_file = request.files['audio']
        if audio_file.filename == '':
            logging.warning("No selected audio file.")
            return {'message': 'No selected audio file'}, 400
        if not allowed_file(audio_file.filename, ALLOWED_AUDIO_EXTENSIONS):
            logging.warning(f"Audio file extension not allowed: {audio_file.filename}")
            return {'message': 'Audio file type not allowed'}, 400

        # Sanitize and save audio file
        audio_filename = secure_filename(audio_file.filename)
        unique_audio_filename = f"{uuid.uuid4()}_{audio_filename}"
        audio_filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_audio_filename)
        try:
            audio_file.save(audio_filepath)
            logging.info(f"Audio file saved to: {audio_filepath}")
        except Exception as e:
            logging.error(f"Failed to save audio file: {e}")
            return {'message': f'Failed to save audio file: {str(e)}'}, 500

        # Extract and validate other parameters
        waveform_style = request.form.get('waveformStyle')
        waveform_color = request.form.get('waveformColor')
        background_color_hex = request.form.get('backgroundColor')
        background_opacity_str = request.form.get('backgroundOpacity')
        playback_speed_str = request.form.get('playbackSpeed')
        text_overlay = request.form.get('textOverlay', '')
        # This download_format is now for the *audio stream within the video*
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
            try:
                background_image_file.save(background_image_filepath)
                logging.info(f"Background image saved to: {background_image_filepath}")
            except Exception as e:
                logging.error(f"Failed to save background image: {e}")
                return {'message': f'Failed to save background image: {str(e)}'}, 500

        output_video_filename = f"waveform_video_{uuid.uuid4()}.mp4" # Always output MP4 video
        output_video_filepath = os.path.join(app.config['GENERATED_FILES_FOLDER'], output_video_filename)

        temp_frames_dir = os.path.join(app.config['TEMP_FRAMES_FOLDER'], str(uuid.uuid4()))
        os.makedirs(temp_frames_dir, exist_ok=True)

        try:
            # 1. Load the audio clip
            audio_clip = AudioFileClip(audio_filepath)
            
            # Apply playback speed to audio clip
            if playback_speed != 1.0:
                audio_clip = audio_clip.speedx(playback_speed)

            # Define video dimensions and FPS
            video_width, video_height = 1280, 720 
            video_fps = 24 # Standard video FPS

            # 2. Generate waveform frames
            waveform_frame_paths = generate_waveform_frames(
                audio_filepath, audio_clip.duration, video_fps, 
                video_width, video_height, waveform_style, waveform_color, temp_frames_dir
            )
            waveform_clip = ImageSequenceClip(waveform_frame_paths, fps=video_fps)

            # 3. Create the background video clip
            if background_image_filepath:
                background_clip = ImageClip(background_image_filepath).set_duration(audio_clip.duration)
                background_clip = background_clip.resize(newsize=(video_width, video_height)) 
            else:
                rgb_color = hex_to_rgb(background_color_hex)
                background_clip = ColorClip(size=(video_width, video_height), 
                                            color=rgb_color, 
                                            duration=audio_clip.duration)
                # For opacity, MoviePy handles it when compositing if the top layer has alpha.
                # If background_clip itself needs opacity, it would be done via compositing with a transparent layer.
                # For a solid color background, opacity is less relevant unless compositing with another video.

            # 4. Create the text overlay clip
            if text_overlay:
                text_clip = TextClip(text_overlay, 
                                     fontsize=50, 
                                     color='white', 
                                     font='sans', # Use a generic font or specify a path to a .ttf if available
                                     stroke_color='black',
                                     stroke_width=1,
                                     bg_color='transparent')
                text_clip = text_clip.set_position(('center', 0.05), relative=True).set_duration(audio_clip.duration)
                
                # Composite background, waveform, and text
                final_video_clip = CompositeVideoClip([background_clip, waveform_clip, text_clip], size=(video_width, video_height))
            else:
                # Composite background and waveform
                final_video_clip = CompositeVideoClip([background_clip, waveform_clip], size=(video_width, video_height))

            # 5. Set the audio of the final video clip
            final_video_clip = final_video_clip.set_audio(audio_clip)

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

            return jsonify({'message': 'Video generated successfully', 'video_url': video_url}), 200

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
            if os.path.exists(audio_filepath):
                os.remove(audio_filepath)
                logging.info(f"Cleaned up uploaded audio: {audio_filepath}")
            if background_image_filepath and os.path.exists(background_image_filepath):
                os.remove(background_image_filepath)
                logging.info(f"Cleaned up uploaded background image: {background_image_filepath}")
            if os.path.exists(temp_frames_dir):
                import shutil
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
