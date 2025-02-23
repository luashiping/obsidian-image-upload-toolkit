import {App, Editor, FileSystemAdapter, MarkdownView, normalizePath, Notice, TFile} from "obsidian";
import path from "path";
import ImageUploader from "./imageUploader";
import {PublishSettings} from "../publish";
import {resolve, relative, dirname, join} from 'path';

const MD_REGEX = /\!\[(.*)\]\((.*?\.(png|jpg|jpeg|gif|svg|webp|excalidraw))\)/g;
const WIKI_REGEX = /\!\[\[(.*?\.(png|jpg|jpeg|gif|svg|webp|excalidraw))(|.*)?\]\]/g;
const PROPERTIES_REGEX = /^---[\s\S]+?---\n/;

interface Image {
    name: string;
    path: string;
    url: string;
    source: string;
}

export const ACTION_PUBLISH: string = "PUBLISH";

export default class ImageTagProcessor {
    private app: App;
    private readonly imageUploader: ImageUploader;
    private settings: PublishSettings;
    private adapter: FileSystemAdapter;

    constructor(app: App, settings: PublishSettings, imageUploader: ImageUploader) {
        this.app = app;
        this.adapter = this.app.vault.adapter as FileSystemAdapter;
        this.settings = settings;
        this.imageUploader = imageUploader;
    }

    public async process(action: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file");
            return;
        }

        let value = this.getValue();
        const basePath = this.adapter.getBasePath();
        const promises: Promise<Image>[] = [];
        const images = this.getImageLists(value);
        const uploader = this.imageUploader;

        for (const image of images) {
            const imageFile = await this.app.vault.getAbstractFileByPath(image.path);
            if (!imageFile) {
                new Notice(`Can NOT locate ${image.name} with ${image.path}, please check image path or attachment option in plugin setting!`, 10000);
                console.log(`${image.path} not exist`);
                break;
            }

            const buf = await this.adapter.readBinary(image.path);
            promises.push(new Promise(function (resolve) {
                uploader.upload(new File([buf], image.name), basePath + '/' + image.path).then(imgUrl => {
                    image.url = imgUrl;
                    resolve(image);
                }).catch(e => {
                    new Notice(`Upload ${image.path} failed, remote server returned an error: ${e.error || e.message || e}`, 10000);
                });
            }));
        }

        return promises.length >= 0 && Promise.all(promises).then(images => {
            let altText;
            for (const image of images) {
                altText = this.settings.imageAltText ? path.parse(image.name)?.name?.replaceAll("-", " ")?.replaceAll("_", " ") : '';
                value = value.replaceAll(image.source, `![${altText}](${image.url})`);
            }
            if (this.settings.replaceOriginalDoc) {
                this.getEditor()?.setValue(value);
            }
            if (this.settings.ignoreProperties) {
                value = value.replace(PROPERTIES_REGEX, '');
            }
            switch (action) {
                case ACTION_PUBLISH:
                    navigator.clipboard.writeText(value);
                    new Notice("Copied to clipboard");
                    break;
                // more cases
                default:
                    throw new Error("invalid action!")
            }
        })
    }

    private getImageLists(value: string): Image[] {
        const images: Image[] = [];
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return images;
        }

        const attachmentPath = this.getAttachmentPath(activeFile);

        const wikiMatches = value.matchAll(WIKI_REGEX);
        const mdMatches = value.matchAll(MD_REGEX);
        
        for (const match of wikiMatches) {
            const name = match[1];
            let path_name = name;
            if (name.endsWith('.excalidraw')) {
                path_name = name + '.png';
            }
            
            // 构建图片路径
            const imagePath = join(attachmentPath, path_name);
            
            images.push({
                name: name,
                path: normalizePath(imagePath), // 使用 normalizePath 确保路径格式正确
                source: match[0],
                url: '',
            });
        }

        for (const match of mdMatches) {
            if (match[2].startsWith('http://') || match[2].startsWith('https://')) {
                continue;
            }
            const decodedPath = decodeURI(match[2]);
            
            // 对于 MD 语法的图片，如果使用相对路径且路径不是绝对路径
            let imagePath = decodedPath;
            if (this.settings.useRelativePath && !decodedPath.startsWith('/')) {
                const notePath = dirname(activeFile.path);
                imagePath = join(notePath, decodedPath);
            }

            images.push({
                name: path.basename(decodedPath),
                path: normalizePath(imagePath),
                source: match[0],
                url: '',
            });
        }
        return images;
    }

    private getAttachmentPath(activeFile: TFile): string {
        if (!this.settings.useRelativePath) {
            // Use vault root as base when useRelativePath is false
            return this.settings.attachmentLocation;
        }

        // When useRelativePath is true, resolve path relative to the current note
        const notePath = dirname(activeFile.path);
        const relativePath = this.settings.attachmentLocation.replace(/^\.\//, '');
        return join(notePath, relativePath);
    }

    private async findImage(imagePath: string, activeFile: TFile): Promise<TFile | null> {
        // First try to find image in the attachment location
        const attachmentPath = this.getAttachmentPath(activeFile);
        const imageInAttachmentPath = join(attachmentPath, imagePath);
        const imageFile = this.app.vault.getAbstractFileByPath(imageInAttachmentPath);
        
        if (imageFile instanceof TFile) {
            return imageFile;
        }

        // If not found and using relative paths, try to find relative to the note
        if (this.settings.useRelativePath) {
            const noteDir = dirname(activeFile.path);
            const imageRelativePath = join(noteDir, imagePath);
            const relativeImageFile = this.app.vault.getAbstractFileByPath(imageRelativePath);
            
            if (relativeImageFile instanceof TFile) {
                return relativeImageFile;
            }
        }

        return null;
    }

    private getValue(): string {
        const editor = this.getEditor();
        if (editor) {
            return editor.getValue()
        } else {
            return ""
        }
    }

    private getEditor(): Editor {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            return activeView.editor
        } else {
            return null
        }
    }
}