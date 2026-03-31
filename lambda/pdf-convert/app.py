"""PDF to Markdown conversion Lambda using Docling."""
import json
import os
import tempfile
import boto3

s3 = boto3.client('s3')
DOCUMENTS_BUCKET = os.environ.get('DOCUMENTS_BUCKET', '')


def handler(event, context):
    body = json.loads(event.get('body', '{}'))
    s3_key = body.get('s3Key', '')
    doc_name = body.get('name', 'upload')

    if not s3_key:
        return response(400, {'error': 'Missing s3Key'})

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, 'input.pdf')
            s3.download_file(DOCUMENTS_BUCKET, s3_key, pdf_path)

            from docling.document_converter import DocumentConverter
            converter = DocumentConverter()
            result = converter.convert(pdf_path)
            md_content = result.document.export_to_markdown()

            md_key = f"converted/markdown/{doc_name}.md"
            s3.put_object(
                Bucket=DOCUMENTS_BUCKET,
                Key=md_key,
                Body=md_content.encode('utf-8'),
                ContentType='text/markdown',
            )

            return response(200, {
                'success': True,
                'content': md_content,
                'mdS3Key': md_key,
                'charCount': len(md_content),
            })
    except Exception as e:
        print(f'PDF conversion error: {e}')
        return response(500, {'error': f'PDF conversion failed: {str(e)}'})


def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
