import { loadNostrUser, type NostrUser } from '@nostr/gadgets/metadata';
import { decode } from '@nostr/tools/nip19';
import showdown from 'showdown';
import { type NostrEvent } from '@nostr/tools/core';

export function isRootNote(event: NostrEvent) {
	// Loop through the tags and check the condition
	for (let tag of event.tags) {
		if (tag[0] === 'e' && (tag[3] === 'root' || tag[3] === 'reply')) {
			return false;
		}
	}
	return true;
}

export function getEventData(event: NostrEvent) {
	let extractedTitle;
	let extractedSummary;

	if (event.kind == 30023) {
		extractedTitle = event?.tags.find(([k]) => k === 'title')?.[1] || 'No title';
		extractedSummary = event?.tags.find(([k]) => k === 'summary')?.[1] || undefined;
	} else {
		extractedTitle =
			'Note of ' +
			new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'long', year: 'numeric' }).format(
				new Date(event.created_at * 1000)
			);
		extractedSummary = event.content.slice(0, 200) + '...';
	}

	return {
		id: event.id,
		kind: event.kind,
		created_at: event.created_at,
		title: extractedTitle,
		image: event?.tags.find(([k]) => k === 'image')?.[1] || undefined,
		summary: extractedSummary,
		content: event.content
	};
}

export async function getProfile(code: string): Promise<NostrUser | null> {
	let pubkey: string;
	let relays: string[] = [];

	try {
		let result = decode(code);
		if (result.type === 'npub') {
			pubkey = result.data;
		} else if (result.type === 'nprofile') {
			pubkey = result.data.pubkey;
			relays = result.data.relays || [];
		} else {
			console.error('author should be an npub');
			return null;
		}
	} catch (err) {
		if (code.length === 64) {
			pubkey = code;
		} else {
			console.error('Failed to decode npub:', err);
			return null;
		}
	}

	return loadNostrUser({ pubkey, relays });
}

export async function processUsersEntities(content: string) {
	const regexPrefixedEntities = /nostr:(npub1\w+|nprofile1\w+)/g;
	const matches = content.match(regexPrefixedEntities) || [];

	const replacementPromises = matches.map(async (match) => {
		try {
			const profile = await getProfile(match.slice(6)); // Remove "nostr:" prefix

			if (profile) {
				return { match, replacement: `[${profile.shortName}](${match})` };
			} else {
				return { match, replacement: match }; // Fallback to original match
			}
		} catch (error) {
			console.error('Failed to fetch profile:', error);
			return { match, replacement: match }; // Fallback to original match
		}
	});

	const replacements = await Promise.all(replacementPromises);
	let processedContent = content;
	replacements.forEach(({ match, replacement }) => {
		processedContent = processedContent.replace(match, replacement);
	});

	return processedContent;
}

export function processEventsEntities(content: string | undefined) {
	if (content == undefined) {
		return;
	}
	// Prefix plain "nevent1|note1|npub1|nprofile|<alphanumeric string>" with nostr: for further processing
	// Include also entities without prefix inside a markdown link, e.g. [text](nevent1xxxxx)
	const regexEntities = /(^|\s|\n|\()(nevent1\w+|note1\w+|npub1\w+|nprofile1\w+)(?=\s|\n|\)|$)/gm;
	content = content.replace(regexEntities, (_, p1, group1) => {
		const shortenedString = group1.slice(0, 24);
		return `${p1}nostr:${group1}`;
	});

	// Transform plain nostr:(nevent1|note1|npub1|nprofile)<alphanumeric string> in markdown links
	const regexPrefixedEntities =
		/(^|\s|\n)nostr:(nevent1\w+|note1\w+|npub1\w+|nprofile1\w+)(?=\s|\n|$)/gm;
	content = content.replace(regexPrefixedEntities, (_, p1, group1) => {
		const shortenedString = group1.slice(0, 24);
		return `${p1}[${shortenedString}...](nostr:${group1})`;
	});
	// Transform "nostr:<alphanumeric string>" inside a markedown link with a njump.me link
	const regexNostrLinks = /\(nostr:([a-zA-Z0-9]+)\)/g;
	content = content.replace(regexNostrLinks, (_, group) => {
		// Construct the replacement string with "https://njump.me/<alphanumeric string>
		return `(https://njump.me/${group})`;
	});
	return content;
}

export function cleanMarkdownLinks(content: string) {
	if (content == undefined) {
		return;
	}
	// Regular expression to match markdown links
	const regexMarkdownLinks = /\[([^\]]+)\]\(([^)]+)\)/g;

	// Replace markdown links with just the text
	const cleanedText = content.replace(regexMarkdownLinks, (_, p1) => p1);

	return cleanedText;
}

export function processImageUrls(content: string) {
	if (content == undefined) {
		return;
	}
	// Regular expression to match the image URL
	const imageUrlRegex = /\s*(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|bmp))\s*/gi;

	// Replace the image URL with Markdown syntax
	const markdownText = content.replace(imageUrlRegex, (_, group) => {
		return ` ![Image](${group}) `; // Markdown syntax for displaying an image
	});

	return markdownText;
}

export function processVideoUrls(content) {
	if (content == undefined) {
		return;
	}
	// Regular expression to match the video URL
	const videoUrlRegex = /\s*(https?:\/\/\S+\.(?:mp4|webm|ogg|mov))(\s*|$)/gi;

	// Replace the video URL with HTML <video> tag
	const htmlText = content.replace(videoUrlRegex, (match, group) => {
		return ` <video controls><source src="${group}" type="video/mp4"></video> `;
	});

	return htmlText;
}

export function processAudioUrls(content) {
	// Regular expression to match the audio URL
	const audioUrlRegex = /\s*(https?:\/\/\S+\.(?:mp3))(\s*|$)/gi;

	// Replace the audio URL with HTML <audio> tag
	const htmlText = content.replace(audioUrlRegex, (match, group) => {
		return ` <audio controls src="${group}"></audio> `;
	});

	return htmlText;
}

export function processSmartyPants(content) {
	if (content == undefined) {
		return;
	}
	const replacements = [
		{ regex: /<<|»/g, replacement: '&laquo;' },
		{ regex: />>|«/g, replacement: '&raquo;' },
		{ regex: /\.\.\./g, replacement: '&hellip;' },
		{ regex: /---/g, replacement: '&mdash;' },
		{ regex: /--/g, replacement: '&mdash;' }
	];

	replacements.forEach(({ regex, replacement }) => {
		content = content.replace(regex, replacement);
	});

	return content;
}

export async function processAll(note) {
	let noteContent = note.content;
	// Replace users entities with names
	noteContent = await processUsersEntities(noteContent);
	noteContent = processEventsEntities(noteContent);
	noteContent = processImageUrls(noteContent);
	noteContent = processVideoUrls(noteContent);
	noteContent = processAudioUrls(noteContent);
	noteContent = processSmartyPants(noteContent);

	// Render returns in kind:1
	if (note.kind == 1) {
		noteContent = noteContent.replace(/\n/g, '\n<br/>');
	}

	// Strip duplicate h1 title
	noteContent = noteContent.replace('# ' + note.title, '');

	// Render markdown
	let converter = new showdown.Converter({
		simplifiedAutoLink: true,
		tables: true,
		strikethrough: true
	});
	noteContent = converter.makeHtml(noteContent);

	return noteContent;
}

export function formatDate(timestamp: number, includeTime = false) {
	const date = new Date(timestamp * 1000);

	// Set date options
	const dateOptions = { day: '2-digit', month: 'long', year: 'numeric' };
	const dateParts = new Intl.DateTimeFormat('en-US', dateOptions).formatToParts(date);

	let day, month, year;
	dateParts.forEach((part) => {
		if (part.type === 'day') day = part.value;
		if (part.type === 'month') month = part.value;
		if (part.type === 'year') year = part.value;
	});

	let formattedDate = `${day} ${month} ${year}`;

	// If includeTime is true, add the time in 24-hour format
	if (includeTime) {
		const timeOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
		const timeFormatter = new Intl.DateTimeFormat('en-US', timeOptions);
		const timeString = timeFormatter.format(date);
		formattedDate += ` - ${timeString}`;
	}

	return formattedDate;
}
