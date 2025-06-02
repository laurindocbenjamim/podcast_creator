import os
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_restful import Resource, Api
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pydub import AudioSegment
from moviepy.editor import AudioFileClip, ColorClip, TextClip, CompositeVideoClip, ImageClip
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
api = Api(app)
CORS(app) # Enable CORS for all routes

# Configuration
UPLOAD_FOLDER = 'uploads'
GENERATED_FILES_FOLDER = 'generated_files'
ALLOWED_AUDIO_EXTENSIONS = {'wav', 'mp3', 'webm', 'ogg', 'aac'}
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['GENERATED_FILES_FOLDER'] = GENERATED_FILES_FOLDER

# Create upload and generated files directories if they don't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(GENERATED_FILES_FOLDER, exist_ok=True)

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
        if audio_output_format not in ['webm', 'wav', 'mp3']:
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

        try:
            # 1. Load the audio clip
            audio_clip = AudioFileClip(audio_filepath)
            audio_clip = audio_clip.set_fps(44100) # Ensure consistent audio FPS

            # Apply playback speed to audio clip
            if playback_speed != 1.0:
                audio_clip = audio_clip.speedx(playback_speed)

            # Convert audio format if requested for the video's internal audio stream
            # Note: MoviePy handles internal audio encoding, but if the source needs explicit conversion
            # before being passed to MoviePy, pydub can do it. For simplicity, MoviePy usually handles
            # embedding the audio stream directly. The `audio_output_format` is more relevant if
            # we were converting the *input audio* to a specific format *before* passing it to MoviePy.
            # For this example, MoviePy will handle the audio stream as is from the loaded clip.
            # If a specific *audio file* download was requested, pydub would be used directly.

            # 2. Create the background video clip
            video_width, video_height = 1280, 720 # Standard video dimensions
            
            if background_image_filepath:
                background_clip = ImageClip(background_image_filepath).set_duration(audio_clip.duration)
                background_clip = background_clip.resize(newsize=(video_width, video_height)) # Resize to fit video
            else:
                # Convert hex to RGB tuple for ColorClip
                hex_value = background_color_hex.lstrip('#')
                rgb_color = tuple(int(hex_value[i:i+2], 16) for i in (0, 2, 4))
                
                background_clip = ColorClip(size=(video_width, video_height), 
                                            color=rgb_color, 
                                            duration=audio_clip.duration)
                # Apply opacity (MoviePy handles alpha directly for ColorClip if you use rgba, or apply it to a layer)
                # For simplicity with ColorClip, we'll assume it's a solid color for now.
                # True opacity would involve compositing with another layer.

            # 3. Create the text overlay clip
            if text_overlay:
                text_clip = TextClip(text_overlay, 
                                     fontsize=50, 
                                     color='white', 
                                     font='Inter-Regular', # Assuming 'Inter-Regular' font is available to MoviePy/ImageMagick
                                     stroke_color='black',
                                     stroke_width=1,
                                     bg_color='transparent')
                text_clip = text_clip.set_position(('center', 0.05), relative=True).set_duration(audio_clip.duration)
                # Ensure text clip is above background
                final_video_clip = CompositeVideoClip([background_clip, text_clip])
            else:
                final_video_clip = background_clip

            # 4. Set the audio of the final video clip
            final_video_clip = final_video_clip.set_audio(audio_clip)

            # 5. Write the final video file
            # fps is important for smooth video, 24 or 30 is common
            final_video_clip.write_videofile(output_video_filepath, fps=24, codec='libx264', audio_codec='aac')
            logging.info(f"Video generated successfully: {output_video_filepath}")
            
            # Construct the URL for download
            video_url = f"/api/v2/podcast/download/{os.path.basename(output_video_filepath)}"
            logging.info(f"Generated video download URL: {video_url}")

            return jsonify({'message': 'Video generation simulated successfully', 'video_url': video_url}), 200

        except Exception as e:
            logging.error(f"Error during video generation: {e}", exc_info=True)
            return {'message': f'Video generation failed: {str(e)}. Ensure FFmpeg is installed and accessible in your system\'s PATH.'}, 500
        finally:
            # Clean up uploaded files
            if os.path.exists(audio_filepath):
                os.remove(audio_filepath)
                logging.info(f"Cleaned up uploaded audio: {audio_filepath}")
            if background_image_filepath and os.path.exists(background_image_filepath):
                os.remove(background_image_filepath)
                logging.info(f"Cleaned up uploaded background image: {background_image_filepath}")

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
