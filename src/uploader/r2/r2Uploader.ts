import AWS from 'aws-sdk';
import ImageUploader from "../imageUploader";
import {UploaderUtils} from "../uploaderUtils";

export default class R2Uploader implements ImageUploader {
    private readonly s3!: AWS.S3;
    private readonly bucket!: string;
    private pathTmpl: string;
    private customDomainName: string;
    private readonly endpoint: string;

    constructor(setting: R2Setting) {
        this.endpoint = `https://${setting.accountId}.r2.cloudflarestorage.com`;
        this.s3 = new AWS.S3({
            accessKeyId: setting.accessKeyId,
            secretAccessKey: setting.secretAccessKey,
            endpoint: this.endpoint,
            signatureVersion: 'v4',
            region: 'auto', // R2 uses 'auto' as region
            s3ForcePathStyle: true
        });
        this.bucket = setting.bucketName;
        this.pathTmpl = setting.path;
        this.customDomainName = setting.customDomainName;
    }

    async upload(image: File, fullPath: string): Promise<string> {
        const arrayBuffer = await this.readFileAsArrayBuffer(image);
        const uint8Array = new Uint8Array(arrayBuffer);
        var path = UploaderUtils.generateName(this.pathTmpl, image.name);
        path = path.replace(/^\/+/, ''); // remove leading slashes
        
        const params = {
            Bucket: this.bucket,
            Key: path,
            Body: uint8Array,
            ContentType: image.type,
        };

        return new Promise((resolve, reject) => {
            this.s3.upload(params, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    let url = data.Location;
                    
                    if (this.customDomainName) {
                        url = `https://${this.customDomainName}/${path}`;
                    } else {
                        const publicUrl = data.Location.replace(
                            `${this.endpoint}/${this.bucket}/`,
                            `https://${this.bucket}.r2.dev/`
                        );
                        url = publicUrl;
                    }
                    
                    resolve(url);
                }
            });
        });
    }

    private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
}

export interface R2Setting {
    accessKeyId: string;
    secretAccessKey: string;
    accountId: string;
    bucketName: string;
    path: string;
    customDomainName: string;
} 