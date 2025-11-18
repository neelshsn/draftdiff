import { S3Client } from "@aws-sdk/client-s3";
import "dotenv/config";

export const hasS3Credentials =
    Boolean(process.env.S3_ACCESS_KEY_ID) &&
    Boolean(process.env.S3_SECRET_ACCESS_KEY) &&
    Boolean(process.env.S3_ENDPOINT);

let cachedClient: S3Client | undefined;

export function getS3Client(): S3Client {
    if (!hasS3Credentials) {
        throw new Error("S3 credentials are not configured");
    }
    if (!cachedClient) {
        cachedClient = new S3Client({
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION || "auto",
            credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY_ID!,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
            },
        });
    }
    return cachedClient;
}
