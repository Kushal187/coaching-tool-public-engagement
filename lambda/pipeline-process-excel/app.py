"""Excel processing Lambda for the ingestion pipeline."""
import json
import os
import tempfile
import boto3
import pandas as pd

s3 = boto3.client('s3')
DOCUMENTS_BUCKET = os.environ.get('DOCUMENTS_BUCKET', '')


def handler(event, context):
    """Read Excel from S3, extract entries for pipeline processing."""
    s3_key = event.get('s3Key', 'data/Data Tracker.xlsx')

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            excel_path = os.path.join(tmpdir, 'data.xlsx')
            s3.download_file(DOCUMENTS_BUCKET, s3_key, excel_path)

            df = pd.read_excel(excel_path, sheet_name='Participedia Case Studies')

            entries = []
            for _, row in df.iterrows():
                name = str(row.get('Name', '')).strip()
                if not name:
                    continue

                content_parts = []
                for col in df.columns:
                    val = str(row.get(col, '')).strip()
                    if val and val != 'nan':
                        content_parts.append(f"## {col}\n{val}")

                entries.append({
                    'name': name,
                    'source': 'Participedia Case Studies',
                    'source_url': str(row.get('URL', '')).strip(),
                    'doc_date': str(row.get('Date', '')).strip(),
                    'content': '\n\n'.join(content_parts),
                    'format': 'markdown',
                })

            print(f'Extracted {len(entries)} entries from Excel')
            return entries

    except Exception as e:
        print(f'Excel processing error: {e}')
        raise
