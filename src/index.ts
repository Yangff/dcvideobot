import { Client, TextChannel, CustomStatus, ActivityOptions } from "discord.js-selfbot-v13";
import { command, streamLivestreamVideo, VoiceUdp, setStreamOpts, streamOpts } from "@dank074/discord-video-stream";
import config from "./config.json";
import fs from 'fs';
import path from 'path';

const client = new Client();

client.patchVoiceEvents(); //this is necessary to register event handlers

setStreamOpts(
    config.streamOpts.width, 
    config.streamOpts.height, 
    config.streamOpts.fps, 
    config.streamOpts.bitrateKbps, 
    config.streamOpts.hardware_acc
)

const prefix = '$';

const moviesFolder = config.movieFolder || './movies';

const movieFiles = fs.readdirSync(moviesFolder);
let movies = movieFiles.map(file => {
  const fileName = path.parse(file).name;
  // replace space with _
  return { name: fileName.replace(/ /g, ''), path: path.join(moviesFolder, file) };
});

// print out all movies
console.log(`Available movies:\n${movies.map(m => m.name).join('\n')}`);

const status_idle = () =>  {
    return new CustomStatus()
    .setState('摸鱼进行中')
    .setEmoji('🐟')
}

const status_watch = (name) => {
    return new CustomStatus()
    .setState(`Playing ${name}...`)
    .setEmoji('📽')
}

// ready event
client.on("ready", () => {
    if (client.user) {
        console.log(`--- ${client.user.tag} is ready ---`);
        client.user.setActivity(status_idle() as ActivityOptions)
    }
});

let streamStatus = {
    joined: false,
    joinsucc: false,
    playing: false,
    channelInfo: {
        guildId: '',
        channelId: '',
        cmdChannelId: ''
    },
    starttime: "00:00:00",
    timemark: '',
}

client.on('voiceStateUpdate', (oldState, newState) => {
    // when exit channel
    if (oldState.member?.user.id == client.user?.id) {
        if (oldState.channelId && !newState.channelId) {
            streamStatus.joined = false;
            streamStatus.joinsucc = false;
            streamStatus.playing = false;
            streamStatus.channelInfo = {
                guildId: '',
                channelId: '',
                cmdChannelId: streamStatus.channelInfo.cmdChannelId
            }
            client.user?.setActivity(status_idle() as ActivityOptions)
        }
    }
    // when join channel success
    if (newState.member?.user.id == client.user?.id) {
        if (newState.channelId && !oldState.channelId) {
            streamStatus.joined = true;
            if (newState.guild.id == streamStatus.channelInfo.guildId && newState.channelId == streamStatus.channelInfo.channelId) {
                streamStatus.joinsucc = true;
            }
        }
    }
})

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // ignore bots
    if (message.author.id == client.user?.id) return; // ignore self
    if (!config.commandChannels.includes(message.channel.id)) return; // ignore non-command channels
    if (!message.content.startsWith(prefix)) return; // ignore non-commands
    
    const args = message.content.slice(prefix.length).trim().split(/ +/); // split command and arguments
    if (args.length == 0) return;

    const user_cmd = args.shift()!.toLowerCase();

    if (config.commandChannels.includes(message.channel.id)) {
        switch (user_cmd) {
            case 'play':
                if (streamStatus.joined) {
                    message.reply('Already joined');
                    return;
                }

                // args = [guildId]/[channelId]
                if (args.length == 0) {
                    message.reply('Missing voice channel');
                    return;
                }

                // process args
                const [guildId, channelId] = args.shift()!.split('/');
                if (!guildId || !channelId) {
                    message.reply('Invalid voice channel');
                    return;
                }
                
                // get movie name and find movie file
                let moviename = args.shift()
                let movie = movies.find(m => m.name == moviename);
                
                if (!movie) {
                    message.reply('Movie not found');
                    return;
                }
                
                // get start time from args "hh:mm:ss"
                let startTime = args.shift();
                let options = {}
                // check if start time is valid
                if (startTime) {
                    let time = startTime.split(':');
                    if (time.length != 3) {
                        message.reply('Invalid start time');
                        return;
                    }
                    let h = parseInt(time[0]);
                    let m = parseInt(time[1]);
                    let s = parseInt(time[2]);
                    if (isNaN(h) || isNaN(m) || isNaN(s)) {
                        message.reply('Invalid start time');
                        return;
                    }
                    startTime = `${h}:${m}:${s}`;
                    options['-ss'] = startTime;
                    console.log("Start time: " + startTime);
                }

                await client.joinVoice(guildId, channelId);
                streamStatus.joined = true;
                streamStatus.playing = false;
                streamStatus.starttime = startTime ? startTime : "00:00:00";
                streamStatus.channelInfo = {
                    guildId: guildId,
                    channelId: channelId,
                    cmdChannelId: message.channel.id
                }
                const streamUdpConn = await client.createStream();
                playVideo(movie.path, streamUdpConn, options);
                message.reply('Playing ' + (startTime ? ` from ${startTime} ` : '') + moviename + '...');
                client.user?.setActivity(status_watch(moviename) as ActivityOptions)
                break;
            case 'stop':
                // Implement your stop playing logic here
                client.leaveVoice()
                streamStatus.joined = false;
                streamStatus.joinsucc = false;
                streamStatus.playing = false;
                streamStatus.channelInfo = {
                    guildId: '',
                    channelId: '',
                    cmdChannelId: streamStatus.channelInfo.cmdChannelId
                }
                // use sigquit??
                command?.kill("SIGINT");
                // msg
                message.reply('Stopped playing');
            case 'playtime':
                // streamStatus.starttime + streamStatus.timemark
                // starttime is hh:mm:ss, timemark is hh:mm:ss.000
                let start = streamStatus.starttime.split(':');
                let mark = streamStatus.timemark.split(':');
                let h = parseInt(start[0]) + parseInt(mark[0]);
                let m = parseInt(start[1]) + parseInt(mark[1]);
                let s = parseInt(start[2]) + parseInt(mark[2]);
                if (s >= 60) {
                    m += 1;
                    s -= 60;
                }
                if (m >= 60) {
                    h += 1;
                    m -= 60;
                }
                message.reply(`Play time: ${h}:${m}:${s}`);
                break;
            case 'pause':
                if (!streamStatus.playing) {
                    command?.kill("SIGSTOP");
                    message.reply('Paused');
                    streamStatus.playing = false;
                } else {
                    message.reply('Not playing');
                }
                break;
            case 'resume':
                if (!streamStatus.playing) {
                    command?.kill("SIGCONT");
                    message.reply('Resumed');
                    streamStatus.playing = true;
                } else {
                    message.reply('Not playing');
                }
                break;
            case 'list':
                message.reply(`Available movies:\n${movies.map(m => m.name).join('\n')}`);
                break;
            case 'status':
                message.reply(`Joined: ${streamStatus.joined}\nJoin success: ${streamStatus.joinsucc}\nPlaying: ${streamStatus.playing}\nChannel: ${streamStatus.channelInfo.guildId}/${streamStatus.channelInfo.channelId}\nTimemark: ${streamStatus.timemark}\nStart time: ${streamStatus.starttime}`);
                break;
            case 'refresh':
                // refresh movie list
                const movieFiles = fs.readdirSync(moviesFolder);
                movies = movieFiles.map(file => {
                    const fileName = path.parse(file).name;
                    // replace space with _
                    return { name: fileName.replace(/ /g, ''), path: path.join(moviesFolder, file) };
                });
                message.reply('Movie list refreshed ' + movies.length + ' movies found.\n' + movies.map(m => m.name).join('\n'));
                break;
            case 'help':
                // reply all commands here
                message.reply('Available commands:\nplay [guildId]/[channelId] [movie] [start time]\nstop\nlist\nstatus\nrefresh\nplaytime\npause\nresume\nhelp');
                break;
            default:
                message.reply('Invalid command');
        }
    }
});

client.login(config.token);

let lastPrint = "";

async function playVideo(video: string, udpConn: VoiceUdp, options: any) {
    console.log("Started playing video");

    udpConn.voiceConnection.setSpeaking(true);
    udpConn.voiceConnection.setVideoStatus(true);
    try {
        let videoStream = streamLivestreamVideo(video, udpConn, options);
        command?.on('progress', (msg) => {
            // print timemark if it passed 10 second sionce last print, becareful when it pass 0
            if (streamStatus.timemark) {
                if (lastPrint != "") {
                    let last = lastPrint.split(':');
                    let now = msg.timemark.split(':');
                    // turn to seconds
                    let s = parseInt(now[2]) + parseInt(now[1]) * 60 + parseInt(now[0]) * 3600;
                    let l = parseInt(last[2]) + parseInt(last[1]) * 60 + parseInt(last[0]) * 3600;
                    if (s - l >= 10) {
                        console.log(`Timemark: ${msg.timemark}`);
                        lastPrint = msg.timemark;
                    }
                } else {
                    console.log(`Timemark: ${msg.timemark}`);
                    lastPrint = msg.timemark;
                }
            }
            streamStatus.timemark = msg.timemark;
        });
        const res = await videoStream;
        console.log("Finished playing video " + res);
    } catch (e) {
        console.log(e);
    } finally {
        udpConn.voiceConnection.setSpeaking(false);
        udpConn.voiceConnection.setVideoStatus(false);
    }
    command?.kill("SIGINT");
    // send message to channel, not reply
    (client.channels.cache.get(streamStatus.channelInfo.cmdChannelId) as TextChannel).send('Finished playing video, timemark is ' + streamStatus.timemark);
    client.leaveVoice();
    client.user?.setActivity(status_idle() as ActivityOptions)
    streamStatus.joined = false;
    streamStatus.joinsucc = false;
    streamStatus.playing = false;
    lastPrint = ""
    streamStatus.channelInfo = {
        guildId: '',
        channelId: '',
        cmdChannelId: ''
    }
}

// run server if enabled in config
if (config.server.enabled) {
    // run server.js
    require('./server');
}