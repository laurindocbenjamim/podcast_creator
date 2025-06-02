import os
import uuid
from flask import Flask, request, jsonify, send_from_directory
from flask_restful import Resource, Api
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pydub import AudioSegment
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
        background_color = request.form.get('backgroundColor')
        background_opacity = request.form.get('backgroundOpacity')
        playback_speed = request.form.get('playbackSpeed')
        text_overlay = request.form.get('textOverlay', '')
        download_format = request.form.get('downloadFormat', 'webm').lower() # Default to webm

        # Basic validation for other fields
        if waveform_style not in ['bars', 'lines', 'circles', 'frequency-bars', 'smooth-lines']:
            logging.warning(f"Invalid waveform style: {waveform_style}")
            return {'message': 'Invalid waveform style'}, 400
        if not validate_color(waveform_color):
            logging.warning(f"Invalid waveform color: {waveform_color}")
            return {'message': 'Invalid waveform color format'}, 400
        if not validate_color(background_color):
            logging.warning(f"Invalid background color: {background_color}")
            return {'message': 'Invalid background color format'}, 400
        if not validate_float_range(background_opacity, 0.0, 1.0):
            logging.warning(f"Invalid background opacity: {background_opacity}")
            return {'message': 'Invalid background opacity value (must be between 0 and 1)'}, 400
        if not validate_float_range(playback_speed, 0.1, 5.0): # Assuming reasonable speed range
            logging.warning(f"Invalid playback speed: {playback_speed}")
            return {'message': 'Invalid playback speed value'}, 400
        if download_format not in ['webm', 'wav', 'mp3']:
            logging.warning(f"Invalid download format: {download_format}")
            return {'message': 'Invalid download format'}, 400

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

        # --- Simulate video generation and audio conversion ---
        # In a real application, this is where you'd integrate with a video processing library
        # like FFmpeg, potentially using a queue for long-running tasks.
        
        output_filename_base = f"waveform_video_{uuid.uuid4()}"
        output_audio_filename = f"{output_filename_base}.{download_format}"
        output_audio_filepath = os.path.join(app.config['GENERATED_FILES_FOLDER'], output_audio_filename)

        try:
            # Load the audio using pydub
            audio = AudioSegment.from_file(audio_filepath)

            # Perform conversion if requested
            if download_format == 'wav':
                audio.export(output_audio_filepath, format="wav")
                logging.info(f"Converted audio to WAV: {output_audio_filepath}")
            elif download_format == 'mp3':
                audio.export(output_audio_filepath, format="mp3")
                logging.info(f"Converted audio to MP3: {output_audio_filepath}")
            else: # Default or explicitly webm
                # If original is not webm, re-export as webm for consistency if needed,
                # otherwise just copy/rename for simulation.
                if not audio_filepath.lower().endswith('.webm'):
                    audio.export(output_audio_filepath, format="webm")
                    logging.info(f"Re-exported audio to WebM: {output_audio_filepath}")
                else:
                    # For simulation, just copy the original if it's already webm
                    import shutil
                    shutil.copy(audio_filepath, output_audio_filepath)
                    logging.info(f"Copied original WebM audio: {output_audio_filepath}")

            # Simulate video output (dummy file)
            # In a real scenario, this would be the actual video file generated
            # For this example, we'll just return the converted audio file as the "video" download.
            # You would replace this with actual video generation logic.
            dummy_video_path = output_audio_filepath # Using the converted audio as the dummy video
            
            # Construct the URL for download
            video_url = f"/api/v2/podcast/download/{os.path.basename(dummy_video_path)}"
            logging.info(f"Simulated video generation complete. Download URL: {video_url}")

            return jsonify({'message': 'Video generation simulated successfully', 'video_url': video_url}), 200

        except Exception as e:
            logging.error(f"Error during audio processing or simulation: {e}", exc_info=True)
            return {'message': f'Video generation failed: {str(e)}'}, 500
        finally:
            # Clean up uploaded files (optional, depending on your needs)
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
