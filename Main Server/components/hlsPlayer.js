import Styles from './hlsPlayer.module.css';
import Head from 'next/head'
import Router from 'next/router';
import validateServerAccess from '../lib/validateServerAccess';
import Hls from "hls.js";
import cheomecastHandler from '../lib/chromecastHandler';
import Resolution from '../lib/resolution';
import { castArray } from 'lodash';


export default class HlsPlayer extends React.Component {
    constructor(props) {
        super(props);
        this.server = this.props.server;
        this.id = this.props.id;
        this.type = this.props.type;
        this.src = this.props.src;
        this.hls = undefined;

        this.state = {
            videoPaused: false,
            title: this.props.title,
            subtitles: [],
            resolutions: [],
            activeResolutionLevel: 0, // The index of the active resolution, 0 == higheest, i.e state.resolutions[0]
            activeSubtitleId: -1 // -1 = no subtitle selected
        }

        this.updateCurrentTimeInterval = undefined;

        /* SEEK */
        this.seeking = false; // Flag for seeking
        this.fullscreen = false; // Flag for fullscreen
        this.chromecastSeekValue = 0;
        this.chromecastDuration = 0;

        /* REFS */
        this.seekBar = undefined;
        this.seekBarLabel = undefined;
        this.videoNode = undefined;
        this.videoContainer = undefined;

        /* BINDINGS */
        this.onVideoTimeUpdate = this.onVideoTimeUpdate.bind(this);
        this.toggleFullscreen = this.toggleFullscreen.bind(this);
        this.updateSeekTime = this.updateSeekTime.bind(this);
        this.startSeek = this.startSeek.bind(this);
        this.onPause = this.onPause.bind(this);
        this.onPlay = this.onPlay.bind(this);
        this.seek = this.seek.bind(this);
        this.togglePlay = this.togglePlay.bind(this);
        this.updateVolume = this.updateVolume.bind(this);
        this.onManifestParsed = this.onManifestParsed.bind(this);
        this.onManifestLoaded = this.onManifestLoaded.bind(this);
        this.chromecastDisconnect = this.chromecastDisconnect.bind(this);
        this.updateVideoProgress = this.updateVideoProgress.bind(this);

        let runningOnClient = typeof window !== "undefined";
        if (runningOnClient) {
            this.chromecastHandler = new cheomecastHandler(this.src, this.updateSeekTime, this.chromecastDisconnect);
        }
    }


    /**
     * Setup various listeners
     */
    setupListeners() {
        this.videoNode.ontimeupdate = this.onVideoTimeUpdate;
        this.videoNode.onpause = this.onPause;
        this.videoNode.onplay = this.onPlay;
        this.soundBar.oninput = this.updateVolume;


        this.hls.on(Hls.Events.MANIFEST_PARSED, this.onManifestParsed);
        this.hls.on(Hls.Events.MANIFEST_LOADED, this.onManifestLoaded);
    }

    /**
     * Called when the HLS manifest is parsed
     * 
     * @param {*} event 
     * @param {*} data 
     */
    onManifestParsed(event, data) {
        let resolutions = [];
        // Reversed because hls.levels have reversed order in terms of quality. We want highest quality at top
        for (let i = this.hls.levels.length - 1; i >= 0; i--) {
            resolutions.push(new Resolution(i, data.levels[i].name));
            console.log(resolutions);
        }
        this.setState({
            resolutions: resolutions,
            activeResolutionLevel: this.hls.levels.length-1
        })
    }

    /**
     * Called when the HLS manifest is loaded, save the subtitle tracks
     * @param {*} event 
     * @param {*} data 
     */
    onManifestLoaded(event, data) {
        this.setState({
            subtitles: data.subtitles
        });
    }

    /**
     * Set the volume of the video based on the volume bar value
     */
    updateVolume() {
        const volume = this.soundBar.value / 100;
        if (this.chromecastHandler.isCasting()) {
            this.chromecastHandler.setVolume(volume);
        } else {
            this.videoNode.volume = volume;
        }
    }

    /**
     * Set the title of the video
     * 
     * @param {string} title - The title of the video 
     */
    setTitle(title) {
        this.setState({title: title})
    }

    /**
     * Called when the video plays
     */
    onPlay() {
        this.setState({videoPaused: false});
    }

    /**
     * Called when the video pauses
     */
    onPause() {
        this.setState({videoPaused: true});
    }

    /**
     * Toggle the video play state
     */
    togglePlay() {
        if (this.chromecastHandler.isCasting()) {
            if (this.chromecastHandler.isPaused()) {
                this.updateCurrentTimeInterval = setInterval(this.updateVideoProgress, 5000);
            } else {
                clearInterval(this.updateCurrentTimeInterval);
            }
            this.chromecastHandler.togglePlay();
        } else {
            if (this.videoNode.paused) {
                this.videoNode.play();
                this.updateCurrentTimeInterval = setInterval(this.updateVideoProgress, 5000);
            } else {
                clearInterval(this.updateCurrentTimeInterval);
                this.videoNode.pause();
            }
        }
    }

    /**
     * Shows the video at a given time
     * 
     * @param {number} startTime - The time in seconds to start the video at 
     */
    show(startTime=0) {
        this.videoContainer.style.display = 'block';
        this.videoNode.currentTime = startTime;
        this.togglePlay();
    }

    chromecastRequestTitle(source) {
        console.log(`Sending ${this.state.title} as title to Chromecast`);
        console.log(source);
        return this.state.title;
    }

    componentDidMount() {
        this._ismounted = true;
        if (Hls.isSupported()) {
            this.hls = new Hls({maxMaxBufferLength: 60});
            this.hls.loadSource(this.src);
            this.hls.attachMedia(this.videoNode);
            this.videoNode.volume = 1;
        }
        this.soundBar.value = 100;
        this.seekBar.value = 0;
        this.setupListeners();
    }

    componentWillUnmount() {
        this._ismounted = false;
        this.videoNode.pause();
        this.hls.destroy();
        clearInterval(this.updateCurrentTimeInterval);
        if (this.chromecastHandler.isCasting()) {
            this.chromecastHandler.stopCast();
        }
    }

    /**
     * Update the seekbar to the current video time
     * 
     * @param {number} currentTime - The current time of the video
     * @param {number} duration - The duration of the video
     */
    updateSeekTime(currentTime=this.videoNode.currentTime, duration=this.videoNode.duration) {
        if (this.chromecastHandler.isCasting() && currentTime != 0) {
            this.chromecastSeekValue = currentTime;
            this.chromecastDuration = duration;
        }
        const newValue = this.seekBar.value;
        const newPosition = 10 - (newValue * 0.2);
        const percentage = (currentTime / duration) * 100;

        const scrubbed = this.seekBar.value / 100 * duration;

        let seconds = Math.floor(scrubbed % 60);
        let minutes = Math.floor(scrubbed / 60 % 60);
        let hours   = Math.floor(scrubbed / 3600);

        seconds = seconds >= 10 ? seconds : `0${seconds}`;
        minutes = minutes >= 10 ? minutes : `0${minutes}`;
        const showHours = hours > 0;

        let time = "";
        if (showHours) {
            time = hours !== 0 ? hours + ':' : '';
        }
        time += minutes + ':' + seconds;

        this.seekBarLabel.innerHTML = `<span>${time}</span>`;
        this.seekBarLabel.style.left = `calc(${newValue}% + (${newPosition}px))`;
        if (!this.seeking) {
            this.seekBar.value = percentage;
        }
    }

    /**
     * Starts the seek (disabled the automatic update of the seekbar)
     */
    startSeek() {
        this.seeking = true;
    }

    /**
     * Seek to a position based on the seek bar value
     */
    seek() {
        const seekSeconds = this.seekBar.value / 100 * this.videoNode.duration;
        if (this.chromecastHandler.isCasting()) {
            this.chromecastHandler.seek(seekSeconds);
        } else {
            this.videoNode.currentTime = seekSeconds
            this.updateVideoProgress();
        }
        this.seeking = false;
    }

    /**
     * Get the current time of the video
     * 
     * @returns {string} The current time of the video
     */
    getCurrentTime() {
        if (this.chromecastHandler.isCasting()) {
            return this.chromecastSeekValue;
        } else {
            return this.videoNode.currentTime;
        }
    }

    /**
     * Get the duration of the video
     * 
     * @returns {string} The duration of the video
     */
    getVideoDuration() {
        if (this.chromecastHandler.isCasting()) {
            return this.chromecastDuration;
        } else {
            return this.videoNode.duration;
        }
    }

    /**
     * Update the current time to the server
     */
    updateVideoProgress() {
        validateServerAccess(this.server, (serverToken) => {
            const currentTime = this.getCurrentTime();
            const videoDuration = this.getVideoDuration();
            fetch(`${this.server.server_ip}/api/video/${this.id}/currenttime/set?type=${this.type}&time=${currentTime}&videoDuration=${videoDuration}&token=${serverToken}`);
        });
    }

    /**
     * Called when the video time updates
     */
    onVideoTimeUpdate() {
        if (!this.seeking && this._ismounted) {
            this.updateSeekTime();
        }
    }

    
    /**
     * Toggle fullscreen mode
     */
    toggleFullscreen() {
        try {
            if (!this.fullscreen) {
                if (this.videoNode.requestFullscreen) {
                    this.videoContainer.requestFullscreen();
                } else if (this.videoNode.mozRequestFullScreen) { /* Firefox */
                    this.videoContainer.mozRequestFullScreen();
                } else if (this.videoNode.webkitRequestFullscreen) { /* Chrome, Safari & Opera */
                    this.videoContainer.webkitRequestFullscreen();
                } else if (this.videoNode.msRequestFullscreen) { /* IE/Edge */
                    this.videoContainer.msRequestFullscreen();
                }
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                  } else if (document.mozCancelFullScreen) { /* Firefox */
                    document.mozCancelFullScreen();
                  } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
                    document.webkitExitFullscreen();
                  } else if (document.msExitFullscreen) { /* IE/Edge */
                    document.msExitFullscreen();
                  }
            }
            this.fullscreen = !this.fullscreen;
        } catch(e) {
            console.log(e)
        }
    }

    /**
     * Change subtitle track
     * 
     * @param {object} subtitle - The subtitle object
     */
    setSubtitle(subtitle) {
        console.log(`[HLS] Change subtitle to ${subtitle.name} (id: ${subtitle.id})`)
        if (this.chromecastHandler.isCasting()) {
            this.chromecastHandler.setSubtitle(subtitle.name);
        } else {
            this.hls.subtitleTrack = subtitle.id;
        }
        this.setState({activeSubtitleId: subtitle.id});
    }

    /**
     * Change resolution
     * 
     * @param {Resolution} resolution - The selected resolution
     */
    setResolution(resolution) {
        console.log(`[HLS] Change resolution to ${resolution.name} (level: ${resolution.level})`);
        if (this.chromecastHandler.isCasting()) {
            this.chromecastHandler.setResolution(resolution);
        } else {
            console.log("hej")
            this.hls.nextLevel = resolution.level;
        }
        this.setState({activeResolutionLevel: resolution.level});
    }

    /**
     * Called when the chromecast disconnects
     */
    chromecastDisconnect() {
        clearInterval(this.updateCurrentTimeInterval);
        this.videoNode.currentTime = this.chromecastSeekValue;
        this.togglePlay();
    }
    
    
    render() {
        return (
            <>
                <Head>
                    <script src="//www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"></script>
                </Head>
                <div className={Styles.videoContainer} ref={node => this.videoContainer = node} onDoubleClick={this.toggleFullscreen}>
                    <video ref={node => this.videoNode = node} playsInline className={Styles.videoPlayer} onClick={this.togglePlay} />
                    <div className={Styles.topControls}>
                        <div className={Styles.backImage}  onClick={() => Router.back()}></div>
                    </div>

                    <div className={Styles.videoControls}>
                        <div className={Styles.seekWrapper}>
                            <div className={Styles.seekTime} id="seekTime" ref={node => this.seekBarLabel = node}></div>
                            <input className={Styles.seekbar} type="range" id="seekbar" name="seekbar" ref={node => this.seekBar = node}
                            min="0" max="100" step="0.01" className={Styles.seekbar} onMouseDown={this.startSeek} onMouseUp={this.seek} onInput={this.updateSeekTime}/>
                        </div>

                        <div className={Styles.lowerControls}>
                            <div className={Styles.lowerLeftControls}>
                                {this.state.videoPaused &&
                                    <div className={`${Styles.playButton} ${Styles.playPause} ${Styles.button}`} onClick={this.togglePlay}></div>
                                }
                                {!this.state.videoPaused && 
                                    <div className={`${Styles.pauseButton} ${Styles.playPause} ${Styles.button}`} onClick={this.togglePlay}></div>
                                }

                                <div className={Styles.soundContainer}>
                                    <div className={`${Styles.soundImage} ${Styles.button}`}></div>
                                    <div className={Styles.soundbarContainer}>
                                        <input className={Styles.soundbar} type="range" id="soundbar" name="soundbar" ref={node => this.soundBar = node} />
                                    </div>
                                </div>
                            </div>
                            <div className={Styles.lowerMiddleControls}>
                                <h5 className={Styles.title}>{this.state.title}</h5>
                            </div>
                            <div className={Styles.lowerRightControls}>
                                <div className={`${Styles.fullscreenImage} ${Styles.button}`} onClick={this.toggleFullscreen}></div>
                                <div className={`${Styles.chromecast} ${Styles.button}`} onClick={() => this.chromecastHandler.requestChromecastSession(this.videoNode.currentTime)}>
                                    <google-cast-launcher></google-cast-launcher>
                                </div>
                                {this.state.subtitles.length > 0 &&
                                    <div className={Styles.subtitleContainer}>
                                        <div className={`${Styles.subtitles} ${Styles.button}`}></div>

                                        <div className={Styles.subtitlesList}>
                                            <ul>
                                                {this.state.subtitles.map((subtitle, index) => {
                                                    return (
                                                        <li key={index} className={subtitle.id == this.state.activeSubtitleId ? `${Styles.activeSubtitle}` : ''} onClick={() => this.setSubtitle(subtitle)}>{subtitle.name}</li>
                                                    )
                                                })}
                                            </ul>
                                        </div>
                                    </div>                                
                                }


                                <div className={Styles.resolutionContainer}>
                                    <div className={`${Styles.resolutionImage} ${Styles.button}`}></div>

                                    <div className={Styles.resolutionList}>
                                        <ul>
                                            {this.state.resolutions.map((resolution, index) => {
                                                return (
                                                    <li key={index} className={resolution.level == this.state.activeResolutionLevel ? `${Styles.activeResolution}` : ''} onClick={() => this.setResolution(resolution)}>{resolution.name}</li>
                                                )
                                            })}
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
          </>
        );
    }
}