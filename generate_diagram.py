from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.storage import S3
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.security import SecretsManager, IAM
from diagrams.aws.integration import StepFunctions
from diagrams.aws.management import Cloudwatch
from diagrams.aws.integration import SimpleNotificationServiceSns as SNS
from diagrams.custom import Custom
import os

graph_attr = {
    "fontsize": "28",
    "bgcolor": "white",
    "pad": "0.8",
    "nodesep": "0.8",
    "ranksep": "1.2",
    "splines": "ortho",
}

edge_attr = {
    "color": "#555555",
    "penwidth": "1.5",
}

node_attr = {
    "fontsize": "11",
}

output_path = os.path.join(os.path.dirname(__file__), "aws_architecture")

with Diagram(
    "Coaching Tool - AWS Architecture",
    filename=output_path,
    show=False,
    direction="TB",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
    node_attr=node_attr,
    outformat="png",
):

    cf = CloudFront("CloudFront\nCDN")

    with Cluster("Static Hosting"):
        s3_frontend = S3("Frontend\nBucket (SPA)")

    with Cluster("API Layer"):
        apigw = APIGateway("API Gateway\n(REST)")
        authorizer = Lambda("Admin\nAuthorizer")

    with Cluster("LLM / Streaming Lambda Functions (via Function URLs)"):
        chatbot = Lambda("Chatbot\nStream")
        gen_questions = Lambda("Generate\nQuestions")
        gen_scenarios = Lambda("Generate\nScenarios")
        eval_assess = Lambda("Evaluate\nAssessment")
        gen_reflect = Lambda("Generate\nReflection")
        cross_res = Lambda("Analyze\nCross-Resolution")
        score_cs = Lambda("Score\nCase Studies")

    with Cluster("API Lambda Functions"):
        case_read = Lambda("Case Studies\nRead")
        admin_read = Lambda("Admin\nRead")
        admin_write = Lambda("Admin\nWrite")
        admin_ingest = Lambda("Admin\nIngest")

    with Cluster("Data Layer"):
        with Cluster("DynamoDB Tables"):
            registry_table = Dynamodb("Registry\nTable")
            cache_table = Dynamodb("Cache\nTable (TTL)")
            pipeline_table = Dynamodb("Pipeline\nRuns Table")

        with Cluster("S3 Storage"):
            s3_docs = S3("Documents\nBucket")
            s3_artifacts = S3("Pipeline\nArtifacts")

    with Cluster("Ingestion Pipeline (Step Functions)"):
        sfn = StepFunctions("Ingestion\nState Machine")

        with Cluster("Pipeline Steps"):
            classify = Lambda("Classify\n(Docker)")
            chunk = Lambda("Chunk")
            ingest_w = Lambda("Ingest\nWeaviate")
            summarize = Lambda("Summarize\nCase Study")
            pdf_convert = Lambda("PDF Convert\n(Docker/Python)")
            process_excel = Lambda("Process\nExcel (Docker)")

    with Cluster("Security"):
        secrets = SecretsManager("Secrets Manager\n(OpenAI, Weaviate,\nAdmin Creds)")

    with Cluster("Monitoring"):
        cw = Cloudwatch("CloudWatch\nAlarms & Logs")
        sns = SNS("SNS\nAlerts")

    # CloudFront connections
    cf >> Edge(label="static") >> s3_frontend
    cf >> Edge(label="API routes") >> apigw
    cf >> Edge(label="streaming") >> chatbot

    # API Gateway to Lambdas
    apigw >> authorizer
    apigw >> case_read
    apigw >> admin_read
    apigw >> admin_write
    apigw >> admin_ingest

    # LLM functions connect to secrets
    chatbot >> secrets
    gen_questions >> secrets
    score_cs >> secrets

    # Admin functions to data
    admin_read >> registry_table
    admin_write >> registry_table
    admin_write >> s3_docs
    admin_ingest >> s3_docs
    admin_ingest >> registry_table
    case_read >> registry_table

    # Cache
    chatbot >> cache_table

    # Pipeline trigger
    admin_write >> sfn

    # Step Functions pipeline
    sfn >> classify
    classify >> chunk
    chunk >> ingest_w
    ingest_w >> summarize

    sfn >> pdf_convert
    sfn >> process_excel

    # Pipeline data access
    classify >> s3_artifacts
    chunk >> s3_artifacts
    ingest_w >> secrets
    summarize >> registry_table
    process_excel >> s3_docs

    # Pipeline status
    sfn >> pipeline_table

    # Monitoring
    cw >> sns
