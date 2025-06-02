// Helper function to convert hex color to RGBA string
const hexToRgba = (hex, alpha) => {
    let r = 0, g = 0, b = 0;
    // Handle 3-digit hex
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    }
    // Handle 6-digit hex
    else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Helper function to format time (seconds to MM:SS)
const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
};

// DOM Elements
const audioUpload = document.getElementById('audio-upload');
const togglePlayPauseButton = document.getElementById('toggle-play-pause');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const rewindButton = document.getElementById('rewind-button');
const forwardButton = document.getElementById('forward-button');
const audioFileNameSpan = document.getElementById('audio-file-name');
const messageElement = document.getElementById('message');
const waveformCanvas = document.getElementById('waveform-canvas');
const waveformStyleSelect = document.getElementById('waveform-style');
const waveformColorInput = document.getElementById('waveform-color');
const backgroundColorInput = document.getElementById('background-color');
const backgroundOpacityInput = document.getElementById('background-opacity');
const backgroundOpacityValueSpan = document.getElementById('background-opacity-value');
const backgroundImageInput = document.getElementById('background-image');
const backgroundImagePreview = document.getElementById('background-image-preview');
const textOverlayInput = document.getElementById('text-overlay');
const generateVideoButton = document.getElementById('generate-video-button');
const generationProgressContainer = document.getElementById('generation-progress-container');
const progressBarFill = document.getElementById('progress-bar-fill');
const generationMessage = document.getElementById('generation-message');
const downloadSection = document.getElementById('download-section');
const downloadLink = document.getElementById('download-link');

// New buttons for switching audio sources
const switchToUploadedAudioButton = document.getElementById('switch-to-uploaded-audio');
const switchToRecordedAudioButton = document.getElementById('switch-to-recorded-audio');
const downloadActiveAudioLink = document.getElementById('download-active-audio-link');
const recordedAudioDownloadFormatSelect = document.getElementById('recorded-audio-download-format');

// Audio Playback Progress Bar Elements
const audioPlaybackProgressContainer = document.getElementById('audio-playback-progress-container');
const audioPlaybackProgressFill = document.getElementById('audio-playback-progress-fill');
const currentTimeSpan = document.getElementById('current-time');
const totalDurationSpan = document.getElementById('total-duration');

// Popup Error Alert Elements
const errorAlert = document.getElementById('error-alert');
const errorAlertMessage = document.getElementById('error-alert-message');
const errorAlertCloseButton = document.getElementById('error-alert-close');

// Playback Speed Element
const playbackSpeedSelect = document.getElementById('playback-speed');

// Microphone Recording Elements
const recordButton = document.getElementById('record-button');
const stopRecordButton = document.getElementById('stop-record-button');
const recordingStatusSpan = document.getElementById('recording-status');
const recordWithoutPauseCheckbox = document.getElementById('record-without-pause');

// New AI-Powered Elements
const podcastDescriptionTextarea = document.getElementById('podcast-description');
const generateDescriptionButton = document.getElementById('generate-description-button');
const descriptionLoadingSpinner = document.getElementById('description-loading-spinner');
const suggestedHashtagsTextarea = document.getElementById('suggested-hashtags');
const generateHashtagsButton = document.getElementById('generate-hashtags-button');
const hashtagsLoadingSpinner = document.getElementById('hashtags-loading-spinner');


// MediaRecorder variables
let mediaRecorder;
let audioChunks = [];
let mediaStream; // To store the microphone stream


// State variables
let audioFile = null; // This will hold the File object for the video generation (either uploaded or recorded)
let uploadedAudioUrl = ''; // URL for the uploaded audio file
let recordedAudioUrl = ''; // URL for the recorded audio file
let isPlaying = false;
let waveformStyle = waveformStyleSelect.value;
let waveformColor = waveformColorInput.value;
let backgroundColor = backgroundColorInput.value;
let backgroundOpacity = parseFloat(backgroundOpacityInput.value);
let backgroundImage = '';
let textOverlay = textOverlayInput.value;
let isGenerating = false;
let loadedBgImage = null;
let errorAlertTimeout; // To store the timeout for auto-dismissing the alert
let playbackSpeed = parseFloat(playbackSpeedSelect.value);

// Web Audio API context and nodes
let audioContext = null;
let analyser = null;
let sourceNode = null;

// This will point to the currently active audio element (either currentUploadedAudioElement or currentRecordedAudioElement)
let activeAudioElement = null;
// Store the actual file/blob for uploaded and recorded audio separately
let uploadedAudioFileBlob = null;
let recordedAudioFileBlob = null;

// Dynamically created audio elements for uploaded and recorded audio
let currentUploadedAudioElement = null;
let currentRecordedAudioElement = null;

// Function to show the error alert
const showErrorAlert = (message) => {
    errorAlertMessage.textContent = message;
    errorAlert.classList.add('show');

    // Clear any existing timeout and set a new one to auto-dismiss
    clearTimeout(errorAlertTimeout);
    errorAlertTimeout = setTimeout(() => {
        errorAlert.classList.remove('show');
    }, 5000); // Dismiss after 5 seconds
};

// Function to hide the error alert
const hideErrorAlert = () => {
    errorAlert.classList.remove('show');
    clearTimeout(errorAlertTimeout); // Clear timeout if dismissed manually
};

// Function to update the canvas display (background and text)
const updateCanvasDisplay = () => {
    if (!waveformCanvas) return;

    const ctx = waveformCanvas.getContext('2d');
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;

    ctx.clearRect(0, 0, width, height); // Clear the entire canvas

    // Draw background image or color with opacity
    if (loadedBgImage) {
        ctx.drawImage(loadedBgImage, 0, 0, width, height);
    } else {
        ctx.fillStyle = hexToRgba(backgroundColor, backgroundOpacity);
        ctx.fillRect(0, 0, width, height);
    }

    // Draw text overlay
    ctx.fillStyle = 'white';
    ctx.font = '24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(textOverlay, width / 2, 30);

    // If audio is playing and analyser is ready, draw waveform visuals
    if (isPlaying && analyser && audioContext) {
        drawWaveformVisuals(ctx, width, height, analyser, waveformStyle, waveformColor, textOverlay);
        requestAnimationFrame(drawWaveform); // Continue animation loop
    }
};

// Function to draw the waveform on the canvas (now primarily for animation loop)
const drawWaveform = () => {
    if (!waveformCanvas || !analyser || !audioContext) {
        return;
    }
    updateCanvasDisplay(); // Call the consolidated display update
};

// Helper function to draw the actual waveform visuals
const drawWaveformVisuals = (ctx, width, height, analyserNode, style, color, text) => {
    const bufferLength = analyserNode.frequencyBinCount; // Corrected from frequencyBinBinCount
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    let x = 0;

    switch (style) {
        case 'bars':
            const barWidth = (width / bufferLength) * 2.5;
            x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = dataArray[i] / 255 * height;
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
            break;
        case 'lines':
            ctx.beginPath();
            const sliceWidth = width * 1.0 / bufferLength;
            x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * height / 2;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            ctx.lineTo(width, height / 2);
            ctx.stroke();
            break;
        case 'circles':
            const centerX = width / 2;
            const centerY = height / 2;
            const maxRadius = Math.min(width, height) / 2 - 20;
            for (let i = 0; i < bufferLength; i++) {
                const radius = (dataArray[i] / 255) * maxRadius;
                ctx.beginPath();
                ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                ctx.stroke();
            }
            break;
        case 'frequency-bars':
            const freqBarWidth = width / analyserNode.frequencyBinCount;
            for (let i = 0; i < analyserNode.frequencyBinCount; i++) {
                const barHeight = dataArray[i] * 2;
                ctx.fillRect(i * freqBarWidth, height - barHeight, freqBarWidth * 0.8, barHeight);
            }
            break;
        case 'smooth-lines':
            ctx.beginPath();
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            const segmentWidth = width / bufferLength;
            x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * height / 2;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += segmentWidth;
            }
            ctx.lineTo(width, height / 2);
            ctx.stroke();
            break;
        default:
            break;
    }
};

// Function to attach timeupdate and loadedmetadata listeners to the active audio element
const attachAudioListeners = () => {
    // Remove any existing listeners from previous active elements to prevent duplicates
    // This is crucial when switching active audio elements
    const allManagedAudioElements = [currentUploadedAudioElement, currentRecordedAudioElement];
    allManagedAudioElements.forEach(el => {
        if (el && el._timeUpdateListener) {
            el.removeEventListener('timeupdate', el._timeUpdateListener);
            el.removeEventListener('loadedmetadata', el._loadedMetadataListener);
            el._timeUpdateListener = null;
            el._loadedMetadataListener = null;
        }
    });

    if (activeAudioElement) {
        const timeUpdateListener = () => {
            if (!isNaN(activeAudioElement.duration)) {
                const progress = (activeAudioElement.currentTime / activeAudioElement.duration) * 100;
                audioPlaybackProgressFill.style.width = `${progress}%`;
                currentTimeSpan.textContent = formatTime(activeAudioElement.currentTime);
            }
        };

        const loadedMetadataListener = () => {
            totalDurationSpan.textContent = formatTime(activeAudioElement.duration);
            currentTimeSpan.textContent = '0:00';
            audioPlaybackProgressFill.style.width = '0%';
        };

        activeAudioElement.addEventListener('timeupdate', timeUpdateListener);
        activeAudioElement.addEventListener('loadedmetadata', loadedMetadataListener);

        // Store references to listeners for proper removal later
        activeAudioElement._timeUpdateListener = timeUpdateListener;
        activeAudioElement._loadedMetadataListener = loadedMetadataListener;

        // Also update playback speed if it's set
        activeAudioElement.playbackRate = playbackSpeed;

        activeAudioElement.onended = () => {
            isPlaying = false;
            playIcon.style.display = 'inline';
            pauseIcon.style.display = 'none';
            recordingStatusSpan.textContent = '';
        };
    }
};

// Centralized function to reset the audio visualization and controls for the *current* active element
const resetVisualizationAndControls = () => {
    // Pause any currently playing audio
    if (activeAudioElement) {
        activeAudioElement.pause();
    }
    isPlaying = false;
    playIcon.style.display = 'inline';
    pauseIcon.style.display = 'none';
    currentTimeSpan.textContent = '0:00';
    totalDurationSpan.textContent = '0:00';
    audioPlaybackProgressFill.style.width = '0%';
    // audioFileNameSpan.textContent is updated by load functions, so no reset here
    messageElement.textContent = '';
    downloadSection.style.display = 'none';
    generationProgressContainer.style.display = 'none';

    // Disconnect and nullify Web Audio API nodes for visualization
    if (sourceNode) {
        sourceNode.disconnect();
        sourceNode = null;
    }
    if (analyser) {
        analyser = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    updateCanvasDisplay(); // Clear canvas
};

// Function to set up Web Audio API for a given audio element
const setupWebAudioAPI = (audioEl) => {
    // Ensure any previous Web Audio API setup is cleared
    if (sourceNode) sourceNode.disconnect();
    if (audioContext) audioContext.close(); // Close the previous context

    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaElementSource(audioEl);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
};

// Function to load and activate uploaded audio
const loadUploadedAudio = (file) => {
    resetVisualizationAndControls(); // Reset visuals and controls

    uploadedAudioFileBlob = file; // Store the blob for video generation
    audioFile = uploadedAudioFileBlob; // Set the audioFile for video generation

    // Clean up previous dynamically created uploaded audio element if it exists
    if (currentUploadedAudioElement) {
        currentUploadedAudioElement.pause();
        URL.revokeObjectURL(currentUploadedAudioElement.src); // Revoke its object URL
        currentUploadedAudioElement.remove(); // Remove from DOM
        currentUploadedAudioElement = null;
    }

    // Create a brand new audio element for the uploaded file
    currentUploadedAudioElement = new Audio();
    currentUploadedAudioElement.src = URL.createObjectURL(file);
    currentUploadedAudioElement.playbackRate = playbackSpeed;
    currentUploadedAudioElement.style.display = 'none'; // Keep hidden
    document.body.appendChild(currentUploadedAudioElement); // Add to DOM

    // Pause the other audio element (recorded audio) if it exists
    if (currentRecordedAudioElement) {
        currentRecordedAudioElement.pause();
    }

    activeAudioElement = currentUploadedAudioElement; // Set active element
    setupWebAudioAPI(activeAudioElement); // Setup Web Audio API for it
    attachAudioListeners(); // Attach listeners
    audioFileNameSpan.textContent = file.name || 'Uploaded Audio';

    // Update the general download link for the active audio
    downloadActiveAudioLink.href = currentUploadedAudioElement.src;
    downloadActiveAudioLink.download = file.name ? `uploaded_audio_${file.name}` : 'uploaded_audio.webm';
    downloadActiveAudioLink.style.display = 'inline-flex';
    recordedAudioDownloadFormatSelect.style.display = 'none'; // Hide format selector for uploaded audio
    messageElement.textContent = ''; // Clear any previous format warning

    updateCanvasDisplay();
};

// Function to load and activate recorded audio
const loadRecordedAudio = (blob) => {
    resetVisualizationAndControls(); // Reset visuals and controls

    recordedAudioFileBlob = blob; // Store the blob for video generation
    audioFile = recordedAudioFileBlob; // Set the audioFile for video generation

    // Clean up previous dynamically created recorded audio element if it's not the same blob
    if (currentRecordedAudioElement && currentRecordedAudioElement.src !== URL.createObjectURL(blob)) {
        currentRecordedAudioElement.pause();
        URL.revokeObjectURL(currentRecordedAudioElement.src); // Revoke its object URL
        currentRecordedAudioElement.remove(); // Remove from DOM
        currentRecordedAudioElement = null;
    }

    // Create a brand new audio element for the recorded blob if it doesn't exist or is a new blob
    if (!currentRecordedAudioElement) {
        currentRecordedAudioElement = new Audio();
        currentRecordedAudioElement.src = URL.createObjectURL(blob);
        currentRecordedAudioElement.playbackRate = playbackSpeed;
        currentRecordedAudioElement.style.display = 'none'; // Keep hidden
        document.body.appendChild(currentRecordedAudioElement); // Add to DOM
    } else {
         // If it's the same element, just update its source and playback rate
        currentRecordedAudioElement.src = URL.createObjectURL(blob);
        currentRecordedAudioElement.playbackRate = playbackSpeed;
    }


    // Pause the other audio element (uploaded audio) if it exists
    if (currentUploadedAudioElement) {
        currentUploadedAudioElement.pause();
    }

    activeAudioElement = currentRecordedAudioElement; // Set active element
    setupWebAudioAPI(activeAudioElement); // Setup Web Audio API for it
    attachAudioListeners(); // Attach listeners
    audioFileNameSpan.textContent = 'Recorded Audio';

    // Update the general download link for the active audio
    downloadActiveAudioLink.href = currentRecordedAudioElement.src;
    downloadActiveAudioLink.download = 'recorded_audio.webm'; // Always webm for recorded audio
    downloadActiveAudioLink.style.display = 'inline-flex';
    recordedAudioDownloadFormatSelect.style.display = 'inline-block'; // Show for recorded audio
    messageElement.textContent = 'Note: Recorded audio is saved as WebM. WAV/MP3 conversion is not supported client-side.'; // Inform user
    messageElement.style.color = '#fca5a5'; // Red color for warning

    updateCanvasDisplay();
};


// Event Listeners
audioUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('audio/')) {
        loadUploadedAudio(file);
    } else {
        resetVisualizationAndControls(); // Reset if invalid file
        showErrorAlert('Please select a valid audio file.');
    }
});

togglePlayPauseButton.addEventListener('click', async () => {
    if (!activeAudioElement || !activeAudioElement.src) {
        showErrorAlert('Audio not ready. Please select an audio file or record one.');
        return;
    }

    if (audioContext && audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('AudioContext resumed.');
        } catch (e) {
            console.error("AudioContext resume failed:", e);
            showErrorAlert('Failed to resume audio. Browser might be preventing autoplay.');
            return;
        }
    }

    if (activeAudioElement.paused) {
        try {
            await activeAudioElement.play();
            isPlaying = true;
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'inline';
            messageElement.textContent = '';
            updateCanvasDisplay();
        }
        catch (e) {
            console.error("Audio playback failed:", e);
            showErrorAlert('Audio playback failed. Please ensure user interaction and try again.');
            isPlaying = false;
            playIcon.style.display = 'inline';
            pauseIcon.style.display = 'none';
        }
    } else {
        activeAudioElement.pause();
        isPlaying = false;
        playIcon.style.display = 'inline';
        pauseIcon.style.display = 'none';
        messageElement.textContent = '';
    }
});

rewindButton.addEventListener('click', () => {
    if (activeAudioElement && activeAudioElement.src) {
        activeAudioElement.currentTime = Math.max(0, activeAudioElement.currentTime - 5);
    } else {
        showErrorAlert('No audio loaded to rewind.');
    }
});

forwardButton.addEventListener('click', () => {
    if (activeAudioElement && activeAudioElement.src) {
        activeAudioElement.currentTime = Math.min(activeAudioElement.duration, activeAudioElement.currentTime + 5);
    } else {
        showErrorAlert('No audio loaded to fast forward.');
    }
});

audioPlaybackProgressContainer.addEventListener('click', (event) => {
    if (!activeAudioElement || isNaN(activeAudioElement.duration)) {
        showErrorAlert('Please load an audio file first to seek.');
        return;
    }
    const progressBarRect = audioPlaybackProgressContainer.getBoundingClientRect();
    const clickX = event.clientX - progressBarRect.left;
    const newTime = (clickX / progressBarRect.width) * activeAudioElement.duration;
    activeAudioElement.currentTime = newTime;
});

playbackSpeedSelect.addEventListener('change', (event) => {
    playbackSpeed = parseFloat(event.target.value);
    if (activeAudioElement) {
        activeAudioElement.playbackRate = playbackSpeed;
    }
});

waveformStyleSelect.addEventListener('change', (event) => {
    waveformStyle = event.target.value;
    updateCanvasDisplay();
});

waveformColorInput.addEventListener('input', (event) => {
    waveformColor = event.target.value;
    updateCanvasDisplay();
});

backgroundColorInput.addEventListener('input', (event) => {
    backgroundColor = event.target.value;
    updateCanvasDisplay();
});

backgroundOpacityInput.addEventListener('input', (event) => {
    backgroundOpacity = parseFloat(event.target.value);
    backgroundOpacityValueSpan.textContent = `${Math.round(backgroundOpacity * 100)}%`;
    updateCanvasDisplay();
});

backgroundImageInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        backgroundImage = url;
        messageElement.textContent = '';

        const img = new Image();
        img.src = url;
        img.onload = () => {
            loadedBgImage = img;
            backgroundImagePreview.src = url;
            backgroundImagePreview.style.display = 'block';
            updateCanvasDisplay();
        };
        img.onerror = () => {
            console.error("Failed to load background image.");
            loadedBgImage = null;
            backgroundImage = '';
            backgroundImagePreview.style.display = 'none';
            showErrorAlert('Failed to load background image. Using background color instead.');
            updateCanvasDisplay();
        };
    } else {
        backgroundImage = '';
        loadedBgImage = null;
        backgroundImagePreview.style.display = 'none';
        showErrorAlert('Please select a valid image file for the background.');
        updateCanvasDisplay();
    }
});

textOverlayInput.addEventListener('input', (event) => {
    textOverlay = event.target.value;
    updateCanvasDisplay();
});

// Microphone Recording Logic
recordButton.addEventListener('click', async () => {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(mediaStream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

            loadRecordedAudio(audioBlob); // Load and activate recorded audio

            recordingStatusSpan.textContent = 'Recording stopped. Audio loaded.';
            recordButton.style.display = 'inline-flex';
            stopRecordButton.style.display = 'none';
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop()); // Stop microphone track
            }
        };

        mediaRecorder.start();
        recordingStatusSpan.textContent = 'Recording...';
        recordButton.style.display = 'none';
        stopRecordButton.style.display = 'inline-flex';
        messageElement.textContent = ''; // Clear other messages

        // Conditional pause based on checkbox
        if (!recordWithoutPauseCheckbox.checked) {
            if (activeAudioElement) {
                activeAudioElement.pause(); // Pause any current playback
                isPlaying = false; // Ensure playback state is false
                playIcon.style.display = 'inline';
                pauseIcon.style.display = 'none';
            }
        }

    } catch (err) {
        console.error('Error accessing microphone:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            showErrorAlert('Microphone access denied. Please allow microphone access in your browser settings.');
        } else if (err.name === 'NotFoundError') {
            showErrorAlert('No microphone found. Please ensure a microphone is connected and enabled.');
        } else {
            showErrorAlert(`Error recording audio: ${err.message}`);
        }
        recordButton.style.display = 'inline-flex';
        stopRecordButton.style.display = 'none';
        recordingStatusSpan.textContent = '';
    }
});

stopRecordButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        recordingStatusSpan.textContent = 'Stopping recording...';
    }
});

// Switch audio source buttons
switchToUploadedAudioButton.addEventListener('click', () => {
    if (uploadedAudioFileBlob) {
        loadUploadedAudio(uploadedAudioFileBlob);
    } else {
        showErrorAlert('No uploaded audio available. Please upload an audio file first.');
    }
});

switchToRecordedAudioButton.addEventListener('click', () => {
    if (recordedAudioFileBlob) {
        loadRecordedAudio(recordedAudioFileBlob);
    } else {
        showErrorAlert('No recorded audio available. Please record audio first.');
    }
});

// Event listener for recorded audio download format selection
recordedAudioDownloadFormatSelect.addEventListener('change', (event) => {
    if (event.target.value !== 'webm') {
        messageElement.textContent = 'Warning: Client-side conversion to WAV or MP3 is not supported. The recorded audio will be downloaded as WebM.';
        messageElement.style.color = '#fca5a5'; // Red color for warning
    } else {
        messageElement.textContent = ''; // Clear warning
    }
});


// Gemini API Integration Functions
const callGeminiAPI = async (prompt, loadingSpinner, outputTextarea) => {
    loadingSpinner.style.display = 'inline-block';
    outputTextarea.value = ''; // Clear previous output
    outputTextarea.placeholder = 'Generating...';

    try {
        let chatHistory = [];
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });
        const payload = { contents: chatHistory };
        const apiKey = ""; // Canvas will automatically provide this in runtime
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            outputTextarea.value = text;
            outputTextarea.placeholder = '';
        } else {
            outputTextarea.value = 'Could not generate content. Please try again.';
            outputTextarea.placeholder = '';
            console.error('Unexpected API response structure:', result);
        }
    } catch (error) {
        console.error('Gemini API call failed:', error);
        showErrorAlert(`Gemini API Error: ${error.message}`);
        outputTextarea.value = 'Failed to generate content.';
        outputTextarea.placeholder = '';
    } finally {
        loadingSpinner.style.display = 'none';
    }
};

generateDescriptionButton.addEventListener('click', () => {
    const title = textOverlayInput.value.trim();
    if (!title) {
        showErrorAlert('Please enter a title in "Text/Branding" section to generate a description.');
        return;
    }
    const prompt = `Generate a short, engaging podcast description (around 50-100 words) based on the title: "${title}". Focus on what the podcast might be about and why someone would listen.`;
    callGeminiAPI(prompt, descriptionLoadingSpinner, podcastDescriptionTextarea);
});

generateHashtagsButton.addEventListener('click', () => {
    const description = podcastDescriptionTextarea.value.trim();
    if (!description) {
        showErrorAlert('Please generate a podcast description first to get hashtags.');
        return;
    }
    const prompt = `Generate 10 relevant and popular hashtags for a podcast with the following description: "${description}". Provide them as a comma-separated list, without any introductory text.`;
    callGeminiAPI(prompt, hashtagsLoadingSpinner, suggestedHashtagsTextarea);
});


generateVideoButton.addEventListener('click', async () => {
    if (!audioFile) {
        showErrorAlert('Please select an audio file or record one first.');
        return;
    }

    isGenerating = true;
    generateVideoButton.disabled = true;
    downloadSection.style.display = 'none';
    generationProgressContainer.style.display = 'block';
    progressBarFill.style.width = '0%';
    generationMessage.textContent = 'Preparing data...';
    messageElement.textContent = ''; // Clear general message

    const formData = new FormData();
    formData.append('audio', audioFile); // 'audio' is the field name for the audio file

    // Append other parameters
    formData.append('waveformStyle', waveformStyle);
    formData.append('waveformColor', waveformColor);
    formData.append('backgroundColor', backgroundColor);
    formData.append('backgroundOpacity', backgroundOpacity);
    formData.append('playbackSpeed', playbackSpeed); // Send playback speed to backend

    // Append background image if selected
    const selectedBackgroundImageFile = backgroundImageInput.files[0];
    if (selectedBackgroundImageFile) {
        formData.append('backgroundImage', selectedBackgroundImageFile); // 'backgroundImage' is the field name for the image file
    } else {
        formData.append('backgroundImage', ''); // Send an empty string if no image is selected
    }

    formData.append('textOverlay', textOverlay);

    try {
        // Simulate initial progress quickly
        progressBarFill.style.width = '20%';
        generationMessage.textContent = 'Sending data to server...';

        const response = await fetch('https://192.168.1.252:5000/api/v2/podcast/generate', {
            method: 'POST',
            body: formData,
            // No 'Content-Type' header needed for FormData; browser sets it automatically
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown server error' }));
            throw new Error(`Server error: ${response.status} - ${errorData.message || response.statusText}`);
        }

        // Simulate further progress
        progressBarFill.style.width = '70%';
        generationMessage.textContent = 'Processing video on server...';

        const result = await response.json(); // Assuming backend returns JSON with video_url

        // Simulate final progress
        progressBarFill.style.width = '100%';
        generationMessage.textContent = 'Video generation complete!';

        if (result && result.video_url) {
            downloadLink.href = result.video_url;
            // Dynamically set extension based on URL, default to mp4
            downloadLink.download = `your_waveform_video.${result.video_url.split('.').pop() || 'mp4'}`;
            downloadSection.style.display = 'block';
            generationMessage.textContent = 'Video generated successfully! Click the link below to download.';
        } else {
            // Fallback for unexpected response structure
            downloadLink.href = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'; // Fallback to dummy
            downloadLink.download = 'your_waveform_video.mp4';
            downloadSection.style.display = 'block';
            generationMessage.textContent = 'Video generation completed, but no direct video URL received. Downloading dummy file.';
        }

    } catch (error) {
        console.error('Video generation failed:', error);
        showErrorAlert(`Error generating video: ${error.message}. Please check console for details.`);
        generationProgressContainer.style.display = 'none'; // Hide progress on error
        downloadSection.style.display = 'none'; // Hide download on error
    } finally {
        isGenerating = false;
        generateVideoButton.disabled = false;
    }
});

// Event listener for closing the error alert
errorAlertCloseButton.addEventListener('click', hideErrorAlert);

// Initial setup on page load
document.addEventListener('DOMContentLoaded', () => {
    // No audio is active on initial load. User must upload or record.
    // The audioPlayer element is just a placeholder in the HTML.
    // activeAudioElement will be set when loadUploadedAudio or loadRecordedAudio is called.
    updateCanvasDisplay(); // Initial draw of the canvas with default settings
    recordedAudioDownloadFormatSelect.style.display = 'none'; // Hide by default on load
});

// Cleanup on window unload (important for object URLs)
window.addEventListener('beforeunload', () => {
    // Pause all audio elements
    // The original audioPlayer element is now primarily a placeholder for the uploaded audio's initial state
    // if (audioPlayer) audioPlayer.pause(); // This element is not actively used for playback anymore
    if (currentUploadedAudioElement) currentUploadedAudioElement.pause();
    if (currentRecordedAudioElement) currentRecordedAudioElement.pause();

    // Revoke all object URLs
    // if (uploadedAudioUrl) URL.revokeObjectURL(uploadedAudioUrl); // These are now managed by currentUploadedAudioElement/currentRecordedAudioElement
    // if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl); // These are now managed by currentUploadedAudioElement/currentRecordedAudioElement

    // Remove dynamically created audio elements from DOM
    if (currentUploadedAudioElement) currentUploadedAudioElement.remove();
    if (currentRecordedAudioElement) currentRecordedAudioElement.remove();

    // Close AudioContext and stop media stream
    if (audioContext) audioContext.close();
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
});
