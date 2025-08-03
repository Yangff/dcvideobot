// File List and Upload to config.movieFolder
import config from "./config.json";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const port = config.server.port;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.movieFolder);
    }, 
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    },
});

const upload = multer({ storage: storage });

// app.use(express.static(config.movieFolder));

app.post("/api/upload", upload.single("file"), (req, res) => {
    // provide a return button
    const template = `
        ${template_style}
        <div class="container">
            <h1>File Uploaded</h1>
            <a href="/" class="btn btn-primary">Return</a>
        </div>
    `;
    res.send(template);
})

// UI to show all files in config.movieFolder
const template_style = `
    <!-- provide a bootstrap style by using CDN -->
    <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" integrity="sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z" crossorigin="anonymous">
`

const prettySize = (size: number): string => {
    if (size < 1024) {
        return `${size} B`;
    } else if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(2)} KB`;
    } else if (size < 1024 * 1024 * 1024) {
        return `${(size / 1024 / 1024).toFixed(2)} MB`;
    } else {
        return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }
}

app.get("/", (req, res) => {
    fs.readdir(config.movieFolder, (err, files) => {
        if (err) {
            console.log(err);
        } else {
            // template to show all files with links and a form to upload a file
            const template = `
                ${template_style}
                <!-- use bootstrap to layout the page -->
                <div class="container">
                    <!-- titile -->
                    <h1>File List</h1>
                    <!-- div table files with name size and link to preview -->
                    <div class="table-responsive">
                        <table class="table table-striped table-sm">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Size</th>
                                    <th>Preview</th>
                                    <th>Copy</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${files.map(file => {
                                    const stats = fs.statSync(path.join(config.movieFolder, file));
                                    return `
                                        <tr>
                                            <td>${file}</td>
                                            <!-- pretty file size -->
                                            <td>${prettySize(stats.size)}</td>
                                            <td><a href="/preview/${file}">Preview</a></td>
                                            <!-- copy file name to clipboard -->
                                            <td><a href="#" onclick="navigator.clipboard.writeText('${path.parse(file).name.replace(/ /g, '')}');">Copy</a></td>
                                        </tr>
                                    `;
                                }).join("")}
                            </tbody>
                        </table>
                    </div>
                    <!-- form to upload a file -->
                    <h1>Upload File</h1>
                    <form action="/api/upload" method="post" enctype="multipart/form-data">
                        <div class="form-group">
                            <input type="file" name="file" />
                        </div>
                        <div class="form-group">
                            <button type="submit" class="btn btn-primary">Upload</button>
                        </div>
                    </form>
                </div>
            `;
            res.send(template);
        }
    })
})

let ffmpegRunning = {};

async function ffmpegScreenshot(video) {
    return new Promise<void>((resolve, reject) => {
        if (ffmpegRunning[video]) {
            // wait for ffmpeg to finish
            let wait = () => {
                if (ffmpegRunning[video] == false) {
                    resolve();
                }
                setTimeout(wait, 100);
            }
            wait();
            return;
        }
        ffmpegRunning[video] =  true
        const ffmpeg = require("fluent-ffmpeg");
        const ts = ['10%', '30%', '50%', '70%', '90%'];
        const takeOne = (i) => {
            if (i >= ts.length) {
                ffmpegRunning[video] = false;
                resolve();
                return;
            }
            console.log(`Taking screenshot ${i+1} of ${video} at ${ts[i]}`)
            ffmpeg(`${config.movieFolder}/${video}`).on("end", () => {
                takeOne(i + 1);
            }).on("error", (err) => {
                ffmpegRunning[video] = false;
                reject(err);
            })
            .screenshots({
                count: 1,
                filename: `${video}-${i+1}.jpg`,
                timestamps: [ts[i]],
                folder: config.previewCache,
                // take screenshot at 640x480
                size: "640x480"
            });
        }
        takeOne(0);
    });
}

// generate preview of video file using ffmpeg, cache it to previewCache and serve it
app.get("/api/preview/:file/:id", async (req, res) => {
    const file = req.params.file;
    const id = req.params.id;
    // id should be 1, 2, 3, 4 or 5
    if (id < 1 || id > 5) {
        res.status(404).send("Not Found");
        return;
    }
    // check if preview exists `${file}-%i.jpg`
    const previewFile = path.join(config.previewCache, `${file}-${id}.jpg`);
    if (fs.existsSync(previewFile)) {
        res.sendFile(previewFile);
    } else {
        try {
            await ffmpegScreenshot(file);
        } catch (err) {
            console.log(err);
            res.status(500).send("Internal Server Error");
            return;
        }
        res.sendFile(previewFile);
    }
})

// stringify object to <ul><li>...</li></ul>
const stringify = (obj) => {
    // if string, return it
    if (typeof obj == "string") {
        return obj;
    }

    if (Array.isArray(obj)) {
        return `<ul>${obj.map(item => {
            return `<li>${stringify(item)}</li>`;
        }).join("")}</ul>`;
    } else {
        if (typeof obj == "object") {
            return `<ul>${Object.keys(obj).map(key => {
                return `<li>${key}: ${stringify(obj[key])}</li>`;
            }).join("")}</ul>`;
        } else {
            return obj;
        }

    }
}


// page to show preview
app.get("/preview/:file", (req, res) => {
    const file = req.params.file;
    // check if file exists
    if (!fs.existsSync(path.join(config.movieFolder, file))) {
        res.status(404).send("Not Found");
        return;
    }

    // get metadata of the file and format it to a table with bootstrap using node-fluent-ffmpeg
    const ffmpeg = require("fluent-ffmpeg");
    ffmpeg.ffprobe(`${config.movieFolder}/${file}`, (err, metadata) => {
        if (err) {
            console.log(err);
            res.status(500).send("Internal Server Error");
            return;
        }
        // template to show metadata using bootstrap
        const template = `
            ${template_style}
            <div class="container">
                <h1>Metadata</h1>
                <div class="table-responsive">
                    <table class="table table-striped table-sm">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.keys(metadata.format).map(key => {
                                return `
                                    <tr>
                                        <td>${key}</td>
                                        <td>${stringify(metadata.format[key])}</td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
                <h1>Preview</h1>
                <!-- waterfall layout the preview images -->
                <div class="row">
                    <div class="col-6 col-md-4 col-lg-3">
                        <a href="/api/preview/${file}/1"><img src="/api/preview/${file}/1" class="img-fluid" /></a>
                        <a href="/api/preview/${file}/2"><img src="/api/preview/${file}/2" class="img-fluid" /></a>
                        <a href="/api/preview/${file}/3"><img src="/api/preview/${file}/3" class="img-fluid" /></a>
                    </div>
                    <div class="col-6 col-md-4 col-lg-3">
                        <a href="/api/preview/${file}/4"><img src="/api/preview/${file}/4" class="img-fluid" /></a>
                        <a href="/api/preview/${file}/5"><img src="/api/preview/${file}/5" class="img-fluid" /></a>
                    </div>
                </div>
                <a href="/" class="btn btn-primary">Return</a>
            </div>
        `;
        res.send(template);
    });
})
            
// create cache folder if not exists
if (!fs.existsSync(config.previewCache)) {
    fs.mkdirSync(config.previewCache);
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})

