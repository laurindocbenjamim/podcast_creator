import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause } from 'lucide-react'; // Import Play and Pause icons from lucide-react

// Main App component
const App = () => {
    // State variables for managing the application's data and UI
    const [audioFile, setAudioFile] = useState(null); // Stores the selected audio file object
    const [audioUrl, setAudioUrl] = useState(''); // Stores the URL for the audio element
    const [isPlaying, setIsPlaying] = useState(false); // Controls audio playback state
    const [waveformStyle, setWaveformStyle] = useState('bars'); // Current waveform visualization style
    const [waveformColor, setWaveformColor] = useState('#61fd2d'); // Default waveform color to primary green
    const [backgroundColor, setBackgroundColor] = useState('#121212'); // Default background color to darkest surface
    // Reverted default background image to empty string
    const [backgroundImage, setBackgroundImage] = useState(''); // Default background image URL
    const [textOverlay, setTextOverlay] = useState('Your Title Here'); // Text to overlay on the video
    const [isGenerating, setIsGenerating] = useState(false); // Simulation of video generation status
    const [message, setMessage] = useState(''); // General messages to the user

    // Refs for DOM elements
    const audioRef = useRef(null); // Reference to the HTML audio element
    const canvasRef = useRef(null); // Reference to the HTML canvas element
    const loadedBgImageRef = useRef(null); // Ref to store the loaded background image object

    // Web Audio API context and nodes
    const audioContextRef = useRef(null); // AudioContext instance
    const analyserRef = useRef(null); // AnalyserNode for audio visualization
    const sourceNodeRef = useRef(null); // AudioBufferSourceNode or MediaElementAudioSourceNode

    // Function to handle audio file selection
    const handleAudioFileChange = (event) => {
        const file = event.target.files[0];
        if (file && file.type.startsWith('audio/')) {
            setAudioFile(file);
            const url = URL.createObjectURL(file);
            setAudioUrl(url);
            setMessage(''); // Clear any previous messages
            // Reset audio context and analyser if a new file is loaded
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }
            setIsPlaying(false); // Stop playback when a new file is selected
        } else {
            setAudioFile(null);
            setAudioUrl('');
            setMessage('Please select a valid audio file.');
        }
    };

    // Function to toggle audio playback (play/pause)
    const togglePlayPause = async () => { // Made async to await context.resume()
        const audio = audioRef.current;
        const audioContext = audioContextRef.current;

        if (!audio || !audioContext) {
            setMessage('Audio not ready. Please select an audio file.');
            return;
        }

        // Always try to resume context on user interaction
        if (audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log('AudioContext resumed.');
            } catch (e) {
                console.error("AudioContext resume failed:", e);
                setMessage('Failed to resume audio. Browser might be preventing autoplay.');
                return;
            }
        }

        if (audio.paused) { // Check actual audio element state
            try {
                await audio.play();
                setIsPlaying(true);
                setMessage(''); // Clear message on successful play
            } catch (e) {
                console.error("Audio playback failed:", e);
                setMessage('Audio playback failed. Please ensure user interaction and try again.');
                setIsPlaying(false); // Ensure state reflects failure
            }
        } else {
            audio.pause();
            setIsPlaying(false);
            setMessage(''); // Clear message on pause
        }
    };

    // Function to draw the waveform on the canvas
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        const audioContext = audioContextRef.current;

        // Only draw if canvas, analyser, and audioContext are available
        if (!canvas || !analyser || !audioContext) {
            return;
        }

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw background image if loaded, otherwise draw background color
        if (loadedBgImageRef.current) {
            ctx.drawImage(loadedBgImageRef.current, 0, 0, width, height);
        } else {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);
        }

        // Draw waveform visuals
        drawWaveformVisuals(ctx, width, height, analyser, waveformStyle, waveformColor, textOverlay);

        // Continue animation loop if playing
        if (isPlaying) {
            requestAnimationFrame(drawWaveform);
        }
    }, [isPlaying, waveformStyle, waveformColor, backgroundColor, textOverlay]);

    // Helper function to draw the actual waveform visuals
    const drawWaveformVisuals = (ctx, width, height, analyser, style, color, text) => {
        const bufferLength = analyser.frequencyBinCount; // Number of data points
        const dataArray = new Uint8Array(bufferLength); // Array to hold frequency data
        analyser.getByteFrequencyData(dataArray); // Populate dataArray with frequency data

        ctx.fillStyle = color; // Set waveform color
        ctx.strokeStyle = color; // Set waveform stroke color
        ctx.lineWidth = 2; // Set line width for line style

        // Declare x outside the switch statement to fix "cannot access 'x' before initialization" error
        let x = 0;

        switch (style) {
            case 'bars':
                const barWidth = (width / bufferLength) * 2.5; // Adjust bar width for better visualization
                x = 0; // Reset x for bars
                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = dataArray[i] / 255 * height; // Scale height based on data
                    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
                    x += barWidth + 1; // Add a small gap between bars
                }
                break;
            case 'lines':
                ctx.beginPath();
                const sliceWidth = width * 1.0 / bufferLength;
                x = 0; // Reset x for lines
                for (let i = 0; i < bufferLength; i++) {
                    const v = dataArray[i] / 128.0; // Normalize data to 0-2
                    const y = v * height / 2; // Scale height
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                    x += sliceWidth;
                }
                ctx.lineTo(width, height / 2); // Connect to the end
                ctx.stroke();
                break;
            case 'circles':
                const centerX = width / 2;
                const centerY = height / 2;
                const maxRadius = Math.min(width, height) / 2 - 20; // Max radius for circles
                for (let i = 0; i < bufferLength; i++) {
                    const radius = (dataArray[i] / 255) * maxRadius;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                }
                break;
            default:
                break;
        }

        // Draw text overlay
        ctx.fillStyle = 'white'; // Text color
        ctx.font = '24px Inter, sans-serif'; // Font style
        ctx.textAlign = 'center'; // Center align text
        ctx.fillText(text, width / 2, 30); // Position text at the top center
    };

    // Effect to initialize Web Audio API when audioUrl is set
    useEffect(() => {
        const audio = audioRef.current;
        if (audioUrl && audio) {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            const audioContext = audioContextRef.current;

            // Disconnect previous source if exists
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
            }

            // Create a MediaElementAudioSourceNode from the audio element
            sourceNodeRef.current = audioContext.createMediaElementSource(audio);

            // Create an AnalyserNode
            analyserRef.current = audioContext.createAnalyser();
            analyserRef.current.fftSize = 2048; // Fast Fourier Transform size

            // Connect the nodes: audio source -> analyser -> audio context destination (speakers)
            sourceNodeRef.current.connect(analyserRef.current);
            analyserRef.current.connect(audioContext.destination);

            // Set up event listener for when audio ends
            audio.onended = () => {
                setIsPlaying(false);
            };
        }
    }, [audioUrl]);

    // Effect to start/stop the waveform drawing loop
    useEffect(() => {
        if (isPlaying && analyserRef.current && canvasRef.current && audioContextRef.current) {
            drawWaveform(); // Start drawing
        }
    }, [isPlaying, drawWaveform]);

    // NEW: Effect to trigger redraw when visual settings change (even if not playing)
    useEffect(() => {
        // Only redraw if audio context and analyser are initialized
        // This ensures the canvas updates even if audio is not playing
        if (audioContextRef.current && analyserRef.current) {
            drawWaveform();
        } else if (canvasRef.current) {
            // If audio context/analyser not ready, at least clear and draw background
            const ctx = canvasRef.current.getContext('2d');
            const width = canvasRef.current.width;
            const height = canvasRef.current.height;
            ctx.clearRect(0, 0, width, height);
            if (loadedBgImageRef.current) {
                ctx.drawImage(loadedBgImageRef.current, 0, 0, width, height);
            } else {
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, 0, width, height);
            }
            // Draw text overlay even without waveform data
            ctx.fillStyle = 'white';
            ctx.font = '24px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(textOverlay, width / 2, 30);
        }
    }, [waveformStyle, waveformColor, backgroundColor, backgroundImage, textOverlay, drawWaveform]);


    // Effect to load background image when its URL changes
    useEffect(() => {
        if (backgroundImage) {
            const img = new Image();
            img.src = backgroundImage;
            img.onload = () => {
                loadedBgImageRef.current = img;
            };
            img.onerror = () => {
                console.error("Failed to load background image.");
                loadedBgImageRef.current = null; // Clear the loaded image on error
                setMessage('Failed to load background image. Using background color instead.');
            };
        } else {
            loadedBgImageRef.current = null; // Clear loaded image if no URL
        }
    }, [backgroundImage]); // Dependency on backgroundImage URL

    // Handle background image file selection
    const handleBackgroundImageChange = (event) => {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            setBackgroundImage(url);
            setMessage(''); // Clear any previous messages
        } else {
            setBackgroundImage('');
            setMessage('Please select a valid image file for the background.');
        }
    };

    // Simulate video generation
    const handleGenerateVideo = () => {
        if (!audioFile) {
            setMessage('Please select an audio file first.');
            return;
        }
        setIsGenerating(true);
        setMessage('Simulating video generation... (This would be handled by a powerful backend)');

        // In a real application, this is where you'd send data to your Flask backend:
        // fetch('/api/generate_video', {
        //     method: 'POST',
        //     body: JSON.stringify({
        //         audioFileName: audioFile.name, // Or send the file directly
        //         waveformStyle,
        //         waveformColor,
        //         backgroundColor,
        //         backgroundImage, // Send URL or base64
        //         textOverlay
        //     }),
        //     headers: { 'Content-Type': 'application/json' }
        // })
        // .then(response => response.json())
        // .then(data => {
        //     setIsGenerating(false);
        //     setMessage(`Video generated! Download link: ${data.videoUrl}`);
        // })
        // .catch(error => {
        //     setIsGenerating(false);
        //     setMessage('Video generation failed.');
        //     console.error('Error generating video:', error);
        // });

        // Simulate a delay for demonstration purposes
        setTimeout(() => {
            setIsGenerating(false);
            setMessage('Video generation simulation complete! (A download link would appear here)');
        }, 3000);
    };

    // Ensure cleanup of object URLs and audio context when component unmounts
    useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
            if (backgroundImage) {
                URL.revokeObjectURL(backgroundImage);
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, [audioUrl, backgroundImage]);

    return (
        <div className="min-h-screen bg-[var(--clr-dark-a0)] flex flex-col items-center py-8 font-sans">
            <div className="w-full max-w-4xl bg-[var(--clr-surface-a0)] p-8 rounded-lg shadow-xl">
                <h1 className="text-4xl font-bold text-center text-[var(--clr-light-a0)] mb-8">
                    Audio Waveform Video Creator
                </h1>

                {/* Audio File Selection */}
                <div className="mb-6 p-4 border border-[var(--clr-surface-a10)] rounded-lg bg-[var(--clr-surface-a10)]">
                    <label htmlFor="audio-upload" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                        1. Select Audio File
                    </label>
                    <input
                        type="file"
                        id="audio-upload"
                        accept="audio/*"
                        onChange={handleAudioFileChange}
                        className="block w-full text-sm text-[var(--clr-light-a0)]
                                   file:mr-4 file:py-2 file:px-4
                                   file:rounded-md file:border-0
                                   file:text-sm file:font-semibold
                                   file:bg-[var(--clr-primary-a0)] file:text-[var(--clr-dark-a0)]
                                   hover:file:bg-[var(--clr-primary-a10)] cursor-pointer"
                    />
                    {audioUrl && (
                        <div className="mt-4 flex items-center space-x-4">
                            <audio ref={audioRef} src={audioUrl} controls={false} className="hidden"></audio>
                            <button
                                onClick={togglePlayPause}
                                className="p-3 bg-[var(--clr-primary-a0)] text-[var(--clr-dark-a0)] rounded-md shadow-md
                                           hover:bg-[var(--clr-primary-a10)] focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:ring-offset-2
                                           transition duration-200 ease-in-out transform hover:scale-105"
                                title={isPlaying ? 'Pause Audio' : 'Play Audio'}
                            >
                                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                            </button>
                            <span className="text-[var(--clr-light-a0)]">
                                {audioFile ? audioFile.name : 'No audio selected'}
                            </span>
                        </div>
                    )}
                    {message && <p className="text-red-300 text-sm mt-2">{message}</p>}
                </div>

                {/* Waveform Visualization Preview */}
                <div className="mb-6 p-4 border border-[var(--clr-surface-a10)] rounded-lg bg-[var(--clr-surface-a10)]">
                    <h2 className="text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                        Waveform Preview
                    </h2>
                    <canvas
                        ref={canvasRef}
                        width="800"
                        height="400"
                        className="w-full h-auto bg-[var(--clr-surface-a0)] rounded-md border border-[var(--clr-surface-a20)]"
                    ></canvas>
                </div>

                {/* Customization Options */}
                <div className="mb-6 p-4 border border-[var(--clr-surface-a10)] rounded-lg bg-[var(--clr-surface-a10)] grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="waveform-style" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                            3. Waveform Style
                        </label>
                        <select
                            id="waveform-style"
                            value={waveformStyle}
                            onChange={(e) => setWaveformStyle(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base bg-[var(--clr-surface-a20)] text-[var(--clr-light-a0)] border-[var(--clr-surface-a30)] focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:border-[var(--clr-primary-a0)] sm:text-sm rounded-md"
                        >
                            <option value="bars">Bars</option>
                            <option value="lines">Lines</option>
                            <option value="circles">Circles</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="waveform-color" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                            Waveform Color
                        </label>
                        <input
                            type="color"
                            id="waveform-color"
                            value={waveformColor}
                            onChange={(e) => setWaveformColor(e.target.value)}
                            className="mt-1 block w-full h-10 rounded-md border-[var(--clr-surface-a30)] focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:border-[var(--clr-primary-a0)]"
                        />
                    </div>
                    <div>
                        <label htmlFor="background-color" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                            Background Color
                        </label>
                        <input
                            type="color"
                            id="background-color"
                            value={backgroundColor}
                            onChange={(e) => setBackgroundColor(e.target.value)}
                            className="mt-1 block w-full h-10 rounded-md border-[var(--clr-surface-a30)] focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:border-[var(--clr-primary-a0)]"
                        />
                    </div>
                    <div>
                        <label htmlFor="background-image" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                            4. Background Image (Optional)
                        </label>
                        <input
                            type="file"
                            id="background-image"
                            accept="image/*"
                            onChange={handleBackgroundImageChange}
                            className="block w-full text-sm text-[var(--clr-light-a0)]
                                       file:mr-4 file:py-2 file:px-4
                                       file:rounded-md file:border-0
                                       file:text-sm file:font-semibold
                                       file:bg-[var(--clr-primary-a0)] file:text-[var(--clr-dark-a0)]
                                       hover:file:bg-[var(--clr-primary-a10)] cursor-pointer"
                        />
                        {backgroundImage && (
                            <img src={backgroundImage} alt="Background Preview" className="mt-2 w-24 h-24 object-cover rounded-md" />
                        )}
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="text-overlay" className="block text-lg font-medium text-[var(--clr-light-a0)] mb-2">
                            5. Text/Branding
                        </label>
                        <input
                            type="text"
                            id="text-overlay"
                            value={textOverlay}
                            onChange={(e) => setTextOverlay(e.target.value)}
                            placeholder="Enter text for overlay"
                            className="mt-1 block w-full border border-[var(--clr-surface-a30)] bg-[var(--clr-surface-a20)] text-[var(--clr-light-a0)] rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:border-[var(--clr-primary-a0)] sm:text-sm"
                        />
                    </div>
                </div>

                {/* Export Button */}
                <div className="text-center">
                    <button
                        onClick={handleGenerateVideo}
                        disabled={isGenerating || !audioFile}
                        className={`px-8 py-3 text-xl font-semibold rounded-lg shadow-lg
                                    transition duration-300 ease-in-out transform
                                    ${isGenerating || !audioFile
                                        ? 'bg-[var(--clr-surface-a30)] text-[var(--clr-surface-a50)] cursor-not-allowed'
                                        : 'bg-[var(--clr-primary-a0)] text-[var(--clr-dark-a0)] hover:bg-[var(--clr-primary-a10)] hover:scale-105'
                                    }
                                    focus:outline-none focus:ring-2 focus:ring-[var(--clr-primary-a0)] focus:ring-offset-2`}
                    >
                        {isGenerating ? 'Generating Video...' : '6. Generate Video'}
                    </button>
                    {isGenerating && (
                        <p className="text-gray-400 mt-4">
                            This process can take a while on a real server.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;
