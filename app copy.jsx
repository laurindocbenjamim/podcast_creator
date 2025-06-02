import React, { useState, useRef, useEffect, useCallback } from 'react';

// Main App component
const App = () => {
    // State variables for managing the application's data and UI
    const [audioFile, setAudioFile] = useState(null); // Stores the selected audio file object
    const [audioUrl, setAudioUrl] = useState(''); // Stores the URL for the audio element
    const [isPlaying, setIsPlaying] = useState(false); // Controls audio playback state
    const [waveformStyle, setWaveformStyle] = useState('bars'); // Current waveform visualization style
    const [waveformColor, setWaveformColor] = useState('#007bff'); // Color of the waveform
    const [backgroundColor, setBackgroundColor] = useState('#333333'); // Background color of the visualization
    const [backgroundImage, setBackgroundImage] = useState(''); // URL for the custom background image
    const [textOverlay, setTextOverlay] = useState('Your Title Here'); // Text to overlay on the video
    const [isGenerating, setIsGenerating] = useState(false); // Simulation of video generation status
    const [message, setMessage] = useState(''); // General messages to the user

    // Refs for DOM elements
    const audioRef = useRef(null); // Reference to the HTML audio element
    const canvasRef = useRef(null); // Reference to the HTML canvas element

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
    const togglePlayPause = () => {
        const audio = audioRef.current;
        if (audio) {
            if (isPlaying) {
                audio.pause();
            } else {
                audio.play().catch(e => console.error("Audio playback failed:", e));
            }
            setIsPlaying(!isPlaying);
        }
    };

    // Function to draw the waveform on the canvas
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        const audioContext = audioContextRef.current;

        if (!canvas || !analyser || !audioContext) {
            return; // Exit if necessary components are not ready
        }

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas with background color or image
        ctx.clearRect(0, 0, width, height); // Clear previous frame
        if (backgroundImage) {
            const img = new Image();
            img.src = backgroundImage;
            img.onload = () => {
                ctx.drawImage(img, 0, 0, width, height);
                drawWaveformVisuals(ctx, width, height, analyser, waveformStyle, waveformColor, textOverlay);
                if (isPlaying) {
                    requestAnimationFrame(drawWaveform); // Continue animation loop
                }
            };
            img.onerror = () => {
                // Fallback to background color if image fails to load
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(0, 0, width, height);
                drawWaveformVisuals(ctx, width, height, analyser, waveformStyle, waveformColor, textOverlay);
                if (isPlaying) {
                    requestAnimationFrame(drawWaveform); // Continue animation loop
                }
            };
        } else {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);
            drawWaveformVisuals(ctx, width, height, analyser, waveformStyle, waveformColor, textOverlay);
            if (isPlaying) {
                requestAnimationFrame(drawWaveform); // Continue animation loop
            }
        }
    }, [isPlaying, waveformStyle, waveformColor, backgroundColor, backgroundImage, textOverlay]);

    // Helper function to draw the actual waveform visuals
    const drawWaveformVisuals = (ctx, width, height, analyser, style, color, text) => {
        const bufferLength = analyser.frequencyBinCount; // Number of data points
        const dataArray = new Uint8Array(bufferLength); // Array to hold frequency data
        analyser.getByteFrequencyData(dataArray); // Populate dataArray with frequency data

        ctx.fillStyle = color; // Set waveform color
        ctx.strokeStyle = color; // Set waveform stroke color
        ctx.lineWidth = 2; // Set line width for line style

        switch (style) {
            case 'bars':
                const barWidth = (width / bufferLength) * 2.5; // Adjust bar width for better visualization
                let x = 0;
                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = dataArray[i] / 255 * height; // Scale height based on data
                    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
                    x += barWidth + 1; // Add a small gap between bars
                }
                break;
            case 'lines':
                ctx.beginPath();
                const sliceWidth = width * 1.0 / bufferLength;
                x = 0;
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

    // Handle background image file selection
    const handleBackgroundImageChange = (event) => {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            setBackgroundImage(url);
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
        <div className="min-h-screen bg-gray-100 flex flex-col items-center py-8 font-sans">
            <div className="w-full max-w-4xl bg-white p-8 rounded-lg shadow-xl">
                <h1 className="text-4xl font-bold text-center text-gray-800 mb-8">
                    Audio Waveform Video Creator
                </h1>

                {/* Audio File Selection */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg">
                    <label htmlFor="audio-upload" className="block text-lg font-medium text-gray-700 mb-2">
                        1. Select Audio File
                    </label>
                    <input
                        type="file"
                        id="audio-upload"
                        accept="audio/*"
                        onChange={handleAudioFileChange}
                        className="block w-full text-sm text-gray-900
                                   file:mr-4 file:py-2 file:px-4
                                   file:rounded-md file:border-0
                                   file:text-sm file:font-semibold
                                   file:bg-blue-50 file:text-blue-700
                                   hover:file:bg-blue-100 cursor-pointer"
                    />
                    {audioUrl && (
                        <div className="mt-4 flex items-center space-x-4">
                            <audio ref={audioRef} src={audioUrl} controls={false} className="hidden"></audio>
                            <button
                                onClick={togglePlayPause}
                                className="px-5 py-2 bg-blue-600 text-white rounded-md shadow-md
                                           hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                                           transition duration-200 ease-in-out transform hover:scale-105"
                            >
                                {isPlaying ? 'Pause Audio' : 'Play Audio'}
                            </button>
                            <span className="text-gray-600">
                                {audioFile ? audioFile.name : 'No audio selected'}
                            </span>
                        </div>
                    )}
                    {message && <p className="text-red-500 text-sm mt-2">{message}</p>}
                </div>

                {/* Waveform Visualization Preview */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg">
                    <h2 className="text-lg font-medium text-gray-700 mb-2">
                        Waveform Preview
                    </h2>
                    <canvas
                        ref={canvasRef}
                        width="800"
                        height="400"
                        className="w-full h-auto bg-gray-800 rounded-md border border-gray-300"
                    ></canvas>
                </div>

                {/* Customization Options */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label htmlFor="waveform-style" className="block text-lg font-medium text-gray-700 mb-2">
                            3. Waveform Style
                        </label>
                        <select
                            id="waveform-style"
                            value={waveformStyle}
                            onChange={(e) => setWaveformStyle(e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="bars">Bars</option>
                            <option value="lines">Lines</option>
                            <option value="circles">Circles</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="waveform-color" className="block text-lg font-medium text-gray-700 mb-2">
                            Waveform Color
                        </label>
                        <input
                            type="color"
                            id="waveform-color"
                            value={waveformColor}
                            onChange={(e) => setWaveformColor(e.target.value)}
                            className="mt-1 block w-full h-10 rounded-md border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="background-color" className="block text-lg font-medium text-gray-700 mb-2">
                            Background Color
                        </label>
                        <input
                            type="color"
                            id="background-color"
                            value={backgroundColor}
                            onChange={(e) => setBackgroundColor(e.target.value)}
                            className="mt-1 block w-full h-10 rounded-md border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="background-image" className="block text-lg font-medium text-gray-700 mb-2">
                            4. Background Image (Optional)
                        </label>
                        <input
                            type="file"
                            id="background-image"
                            accept="image/*"
                            onChange={handleBackgroundImageChange}
                            className="block w-full text-sm text-gray-900
                                       file:mr-4 file:py-2 file:px-4
                                       file:rounded-md file:border-0
                                       file:text-sm file:font-semibold
                                       file:bg-green-50 file:text-green-700
                                       hover:file:bg-green-100 cursor-pointer"
                        />
                        {backgroundImage && (
                            <img src={backgroundImage} alt="Background Preview" className="mt-2 w-24 h-24 object-cover rounded-md" />
                        )}
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="text-overlay" className="block text-lg font-medium text-gray-700 mb-2">
                            5. Text/Branding
                        </label>
                        <input
                            type="text"
                            id="text-overlay"
                            value={textOverlay}
                            onChange={(e) => setTextOverlay(e.target.value)}
                            placeholder="Enter text for overlay"
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
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
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-purple-600 text-white hover:bg-purple-700 hover:scale-105'
                                    }
                                    focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2`}
                    >
                        {isGenerating ? 'Generating Video...' : '6. Generate Video'}
                    </button>
                    {isGenerating && (
                        <p className="text-gray-600 mt-4">
                            This process can take a while on a real server.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;
