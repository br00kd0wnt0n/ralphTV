import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET_UPLOADS;

if (!BUCKET) {
  console.error('ERROR: S3_BUCKET_UPLOADS environment variable not set');
  console.log('Usage: S3_BUCKET_UPLOADS=your-bucket-name node get-s3-urls.js');
  process.exit(1);
}

const s3 = new S3Client({ region: AWS_REGION });

console.log('==> Fetching normalized files from S3...');
console.log('==> Bucket:', BUCKET);

const { Contents } = await s3.send(new ListObjectsV2Command({
  Bucket: BUCKET,
  Prefix: 'normalized/'
}));

if (!Contents || Contents.length === 0) {
  console.log('==> No normalized files found');
  process.exit(0);
}

console.log(`==> Found ${Contents.length} normalized files\n`);

for (const file of Contents.slice(0, 5)) { // Show first 5
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: file.Key });
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  const sizeKB = Math.round(file.Size / 1024);
  console.log(`File: ${file.Key}`);
  console.log(`Size: ${sizeKB} KB`);
  console.log(`URL:  ${url}`);
  console.log('');
}

console.log('==> Download one of these URLs and check if it has audio in VLC/QuickTime');
