FROM public.ecr.aws/lambda/python:3.12-arm64

RUN pip install openai

COPY app.py ${LAMBDA_TASK_ROOT}/

CMD ["app.handler"]
