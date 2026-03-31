FROM public.ecr.aws/lambda/python:3.12-arm64

RUN pip install pandas openpyxl boto3 python-dotenv

COPY app.py ${LAMBDA_TASK_ROOT}/

CMD ["app.handler"]
