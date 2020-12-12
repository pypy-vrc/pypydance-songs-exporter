// check = false -> generate
// check = true -> youtube
const CHECK = false;

process.on('unhandledRejection', function (reason, promise) {
	console.log(new Date(), 'unhandledRejection', { reason, promise });
	process.exit();
});

const querystring = require('querystring');
const fs = require('fs');
const XLSX = require('xlsx');
const axios = require('axios');
const characterSet = new Set(); // Set<string>

function assignCharacterSet(text) {
	var fuck = 0;

	for (var c of String(text).split('')) {
		if (c === '\uFEFF') {
			fuck |= 1;
		}
		if (c === '\u200B') {
			fuck |= 2;
		}
		if (c === '\u2764') {
			fuck |= 4;
		}
		if (c.charCodeAt(0) >= 32) {
			characterSet.add(c);
		}
	}

	if (fuck !== 0) {
		console.log('assignCharacterSet', { fuck, text });
	}
}

function parseSongInfo(sheet) {
	var ranges = Object.keys(sheet)
		.filter(v => 'ABCD'.includes(v.charAt(0)) === true)
		.map(v => parseInt(v.substr(1), 10))
		.sort((a, b) => a - b);

	if (ranges.length === 0) {
		return [];
	}

	var minRowIndex = ranges[0];
	var maxRowIndex = ranges[ranges.length - 1];
	var songInfos = [];

	for (var rowIndex = minRowIndex; rowIndex <= maxRowIndex; ++rowIndex) {
		var songInfo = {
			id: sheet[`A${rowIndex}`]?.v ?? null,
			use: sheet[`B${rowIndex}`]?.v ?? null,
			url: sheet[`C${rowIndex}`]?.v ?? null,
			name: sheet[`D${rowIndex}`]?.v ?? null
		};

		if (songInfo.id !== null) {
			songInfo.id = parseInt(songInfo.id, 10);
		}

		songInfo.use = (songInfo.use === 'Y');

		if (songInfo.url !== null) {
			songInfo.url = String(songInfo.url);
		}

		if (songInfo.name !== null) {
			songInfo.name = String(songInfo.name)
				.replace(/\s+/g, ' ')
				.trim();
		}

		if (songInfo.url === null ||
			songInfo.name === null) {
			console.log(`NULL: ${sheetName}!${rowIndex}`, songInfo);
			continue;
		}

		if (songInfo.use === false ||
			songInfo.url === 'N/A') {
			continue;
		}

		assignCharacterSet(songInfo.name);
		songInfos.push(songInfo);
	}

	return songInfos;
}

async function generateSongInfo(sheets, sheetNames) {
	var songIndex = 0;
	var sheetIndex = 0;

	// truncate file
	await fs.promises.writeFile('songs.tsv', '');

	for (var sheetName of sheetNames) {
		++sheetIndex;

		var songInfos = parseSongInfo(sheets[sheetName])
			.sort((a, b) => {
				var A = String(a.name).toLowerCase();
				var B = String(b.name).toLowerCase();
				if (A < B) {
					return -1;
				}
				if (A > B) {
					return 1;
				}
				return 0;
			});

		console.log(sheetIndex, sheetName, songInfos.length);

		for (var songInfo of songInfos) {
			songInfo.id = ++songIndex; // override id
		}

		await Promise.all([
			fs.promises.appendFile(
				'songs.tsv',
				songInfos.map(({ id, url, name }) => {
					return [
						id,
						sheetIndex,
						0, // dancer
						0, // random
						url,
						name
					].join('\0') + '\r\n'; // append
				}).join('')
			),
			fs.promises.writeFile(
				`group-${sheetIndex}.txt`,
				songInfos.map(({ id, url, name }) => {
					name = name.replace('(NEW)', '');
					name = name.replace(/\s+/g, ' ');
					name = name.trim();
					return `${id}: ${name}`;
				}).join('\r\n')
			),
			fs.promises.writeFile(
				`public-${sheetIndex}.txt`,
				songInfos.map(({ id, url, name }) => {
					return `${id}\t${name}`;
				}).join('\r\n')
			),
		]);
	}
}

// YOUTUBE CHECK
async function checkYouTube(sheets, sheetNames) {
	var sheetIndex = 0;
	var videoIdSet = new Set(); // Set<string>

	// truncate file
	await fs.promises.writeFile('youtube.txt', '');
	var logFile = fs.createWriteStream('youtube.txt');

	for (var sheetName of sheetNames) {
		++sheetIndex;

		var songInfos = parseSongInfo(sheets[sheetName]);

		console.log(sheetIndex, sheetName, songInfos.length);

		for (var { url } of songInfos) {
			try {
				var videoId = null;
				var _url = new URL(url);
				if (_url.hostname === 'youtu.be') {
					videoId = _url.pathname.substr(1);
				} else if (_url.pathname === '/watch') {
					videoId = _url.searchParams.get('v');
				}

				if (videoId === null) {
					throw 'videoId is null';
				}

				if (videoIdSet.has(videoId) === true) {
					throw `videoId already exists`;
				}

				videoIdSet.add(videoId);

				var { data } = await axios({
					url: `https://www.youtube.com/get_video_info?video_id=${videoId}&eurl=https://youtube.googleapis.com/v/${videoId}`
				});

				data = querystring.parse(data);
				var playerResponse = JSON.parse(data.player_response);

				var { playabilityStatus: { status, reason } } = playerResponse;
				if (status !== 'OK') {
					throw `${status}:${reason}`;
				}

				var details = {
					mp4_1080p60: false,
					mp4_720p60: false,
					mp4_1080p: false,
					mp4_720p: false,
					mp4_360p: false
				};

				for (var { itag } of playerResponse.streamingData.formats) {
					if (itag == 18) {
						details.mp4_360p = true;
					} else if (itag == 22) {
						details.mp4_720p = true;
					} else if (itag == 37) {
						details.mp4_1080p = true;
					} else if (itag == 298) {
						details.mp4_720p60 = true;
					} else if (itag == 299) {
						details.mp4_1080p60 = true;
					}
				}

				console.log(url, details);
			} catch (err) {
				console.log('ERROR', { url, err });
				logFile.write(`${url}\tERROR\t${String(err)}\n`);
			}
		}
	}

	logFile.end();
}

(async function () {
	for (var c = 32; c < 127; ++c) {
		characterSet.add(String.fromCharCode(c));
	}

	assignCharacterSet(
		(await fs.promises.readFile('chars-input.txt')).toString('utf8')
	);

	var { Sheets: sheets, SheetNames: sheetNames } = XLSX.readFile(
		'가라오케Check_udon.xlsx',
		{
			raw: true
		}
	);

	if (CHECK) {
		await checkYouTube(sheets, sheetNames);
	} else {
		await generateSongInfo(sheets, sheetNames);
	}

	await fs.promises.writeFile(
		'chars-output.txt',
		Array.from(characterSet).sort().join('')
	);
})();
