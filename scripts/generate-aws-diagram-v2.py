"""
AWS Serverless Architecture Diagram — Coaching Tool Public Engagement
v2: Slightly larger text, grouped services. Same layout as v1.
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.storage import S3
from diagrams.aws.database import Dynamodb
from diagrams.aws.security import Cognito, SecretsManager, IAM
from diagrams.aws.integration import StepFunctions, SQS
from diagrams.aws.management import Cloudwatch
from diagrams.aws.general import Users
from diagrams.aws.ml import Sagemaker, Bedrock

import os

output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output", "pdf")
output_path = os.path.join(output_dir, "coaching-tool-aws-architecture-v2")

with Diagram(
    "",
    filename=output_path,
    show=False,
    direction="TB",
    outformat=["png", "pdf"],
    graph_attr={
        "fontsize": "44",
        "fontname": "Helvetica Bold",
        "bgcolor": "white",
        "pad": "2.5",
        "nodesep": "0.8",
        "ranksep": "1.6",
        "splines": "curved",
        "dpi": "250",
    },
    node_attr={
        "fontsize": "15",
        "fontname": "Helvetica Bold",
        "fontcolor": "#1A1A1A",
        "width": "2.2",
        "height": "2.2",
    },
    edge_attr={
        "fontsize": "13",
        "fontname": "Helvetica Bold",
        "fontcolor": "#333333",
        "penwidth": "2.0",
    },
):

    # ═══════════════════════════════════════════════
    #  LEFT: PRACTITIONER FLOW
    # ═══════════════════════════════════════════════

    with Cluster("PRACTITIONER FLOW", graph_attr={
        "bgcolor": "#F0F7FF",
        "style": "rounded,bold",
        "color": "#1565C0",
        "penwidth": "3",
        "fontsize": "22",
        "fontcolor": "#1565C0",
        "fontname": "Helvetica Bold",
    }):
        user = Users("", xlabel="Practitioners")

        with Cluster("Edge & Auth", graph_attr={
            "bgcolor": "#E3F2FD",
            "fontsize": "16",
            "fontname": "Helvetica Bold",
            "fontcolor": "#1565C0",
        }):
            cdn_u = CloudFront("CloudFront CDN\n+ S3 React SPA")
            cog_u = Cognito("Cognito\nUser Pool")

        with Cluster("API Layer", graph_attr={"bgcolor": "#F3E5F5", "fontsize": "16", "fontname": "Helvetica Bold", "fontcolor": "#333333"}):
            rest_gw = APIGateway("REST API GW")
            ws_gw = APIGateway("WebSocket GW\n(SSE Streaming)")

        with Cluster("Microservices (Lambda)", graph_attr={"bgcolor": "#FFF8E1", "fontsize": "16", "fontname": "Helvetica Bold", "fontcolor": "#333333"}):
            chat = Lambda("Chat &\nCoaching")
            assess = Lambda("Assessment\n& Evaluation")
            reflect = Lambda("Generate\nReflection")
            cases = Lambda("Case Studies\nSearch / Score")

        eval_q = SQS("Evaluation\nQueue + DLQ")

        with Cluster("Evaluation Workflow (Step Functions)", graph_attr={"bgcolor": "#E8F5E9", "fontsize": "16", "fontname": "Helvetica Bold", "fontcolor": "#333333"}):
            eval_sfn = StepFunctions("Orchestrator\n(4-Test Framework)")
            cross_fn = Lambda("Cross-\nResolution")
            quality_fn = Lambda("Quality\nEval")

        with Cluster("AI & Data", graph_attr={
            "bgcolor": "#EDE7F6",
            "fontsize": "16",
            "fontname": "Helvetica Bold",
            "fontcolor": "#4527A0",
        }):
            bedrock_u = Bedrock("Amazon Bedrock\n(LLM API)")
            weaviate_u = Sagemaker("Weaviate Vector DB\n(Semantic Search)")
            dynamo_u = Dynamodb("DynamoDB\n(Session State)")

    # ═══════════════════════════════════════════════
    #  RIGHT: ADMIN FLOW
    # ═══════════════════════════════════════════════

    with Cluster("ADMIN FLOW", graph_attr={
        "bgcolor": "#FFF5F5",
        "style": "rounded,bold",
        "color": "#C62828",
        "penwidth": "3",
        "fontsize": "22",
        "fontcolor": "#C62828",
        "fontname": "Helvetica Bold",
    }):
        admin_user = Users("", xlabel="Admin Users")

        with Cluster("Edge & Auth", graph_attr={
            "bgcolor": "#FFEBEE",
            "fontsize": "16",
            "fontname": "Helvetica Bold",
            "fontcolor": "#C62828",
        }):
            cdn_a = CloudFront("CloudFront CDN\n+ S3 Admin SPA")
            cog_a = Cognito("Cognito\nAdmin Role")

        admin_gw = APIGateway("REST API GW\n(Admin Routes)")

        with Cluster("Admin Services (Lambda)", graph_attr={"bgcolor": "#FFF3E0", "fontsize": "16", "fontname": "Helvetica Bold", "fontcolor": "#333333"}):
            admin_stats = Lambda("Stats &\nMonitoring")
            admin_docs = Lambda("Document\nCRUD")
            admin_trigger = Lambda("Trigger\nIngestion")

        with Cluster("Data Ingestion Pipeline (Step Functions)", graph_attr={
            "bgcolor": "#FBE9E7",
            "style": "rounded,bold",
            "color": "#E65100",
            "penwidth": "2",
            "fontsize": "16",
            "fontname": "Helvetica Bold",
            "fontcolor": "#BF360C",
        }):
            ingest_q = SQS("Job Queue")
            ingest_sfn = StepFunctions("Pipeline\nOrchestrator")
            step1 = Lambda("Step 1\nPDF → Markdown")
            step2 = Lambda("Step 2\nDocument\nChunking")
            step3 = Lambda("Step 3\nLLM Content\nClassification")
            step4 = Lambda("Step 4\nCase Study\nEnrichment")

        with Cluster("AI & Data", graph_attr={
            "bgcolor": "#FBE9E7",
            "fontsize": "16",
            "fontname": "Helvetica Bold",
            "fontcolor": "#BF360C",
        }):
            bedrock_a = Bedrock("Amazon Bedrock\n(Classify + Enrich)")
            weaviate_a = Sagemaker("Weaviate Vector DB\n(Ingest Vectors)")
            s3_a = S3("S3 Buckets\n(Docs, Uploads,\nLLM Cache)")

    # ═══════════════════════════════════════════════
    #  SHARED BOTTOM
    # ═══════════════════════════════════════════════

    with Cluster("Security & Observability", graph_attr={
        "bgcolor": "#F5F5F5",
        "fontsize": "16",
        "fontname": "Helvetica Bold",
        "fontcolor": "#333333",
    }):
        secrets = SecretsManager("Secrets Manager\n(Weaviate Key)")
        iam = IAM("IAM Roles\n(Least Privilege)")
        cw = Cloudwatch("CloudWatch\nLogs & Alarms")

    # ═══════════════════════════════════════════════
    #  PRACTITIONER CONNECTIONS
    # ═══════════════════════════════════════════════

    user >> Edge(color="#1565C0", style="bold") >> cdn_u
    user >> Edge(color="#FF8F00", style="dashed", label="auth") >> cog_u

    cdn_u >> Edge(color="#7B1FA2", style="bold") >> ws_gw
    cdn_u >> Edge(color="#1565C0", style="bold") >> rest_gw

    ws_gw >> Edge(color="#7B1FA2", style="bold") >> chat
    rest_gw >> Edge(color="#1565C0") >> assess
    rest_gw >> Edge(color="#1565C0") >> reflect
    rest_gw >> Edge(color="#1565C0") >> cases

    # Eval workflow (async via SQS)
    assess >> Edge(color="#2E7D32", style="bold", label="enqueue") >> eval_q
    eval_q >> Edge(color="#2E7D32", style="bold", label="trigger") >> eval_sfn
    eval_sfn >> Edge(color="#2E7D32") >> cross_fn
    eval_sfn >> Edge(color="#2E7D32") >> quality_fn

    # All user lambdas → Bedrock
    chat >> Edge(color="#D32F2F") >> bedrock_u
    assess >> Edge(color="#D32F2F") >> bedrock_u
    reflect >> Edge(color="#D32F2F") >> bedrock_u
    cases >> Edge(color="#D32F2F") >> bedrock_u

    # User lambdas → Weaviate
    chat >> Edge(color="#00695C") >> weaviate_u
    cases >> Edge(color="#00695C") >> weaviate_u
    reflect >> Edge(color="#00695C") >> weaviate_u

    # Assessment → DynamoDB
    assess >> Edge(color="#546E7A") >> dynamo_u

    # ═══════════════════════════════════════════════
    #  ADMIN CONNECTIONS
    # ═══════════════════════════════════════════════

    admin_user >> Edge(color="#C62828", style="bold") >> cdn_a
    admin_user >> Edge(color="#FF8F00", style="dashed", label="admin auth") >> cog_a

    cdn_a >> Edge(color="#C62828", style="bold") >> admin_gw

    admin_gw >> Edge(color="#C62828") >> admin_stats
    admin_gw >> Edge(color="#C62828") >> admin_docs
    admin_gw >> Edge(color="#C62828") >> admin_trigger

    # Ingestion pipeline (sequential)
    admin_trigger >> Edge(color="#E65100", style="bold", label="enqueue") >> ingest_q
    ingest_q >> Edge(color="#E65100", style="bold") >> ingest_sfn
    ingest_sfn >> Edge(color="#E65100", style="bold") >> step1
    step1 >> Edge(color="#E65100", style="bold") >> step2
    step2 >> Edge(color="#E65100", style="bold") >> step3
    step3 >> Edge(color="#E65100", style="bold") >> step4

    # Pipeline → Bedrock
    step3 >> Edge(color="#D32F2F") >> bedrock_a
    step4 >> Edge(color="#D32F2F") >> bedrock_a

    # Pipeline → Data
    step2 >> Edge(color="#00695C") >> weaviate_a
    step4 >> Edge(color="#00695C") >> weaviate_a
    step1 >> Edge(color="#E65100") >> s3_a
    step4 >> Edge(color="#E65100") >> s3_a

    # Admin docs → Weaviate
    admin_docs >> Edge(color="#546E7A") >> weaviate_a

    # Cross-cutting
    eval_sfn >> Edge(style="dashed", color="#9E9E9E") >> cw
    ingest_sfn >> Edge(style="dashed", color="#9E9E9E") >> cw

print(f"\nDiagram generated:")
print(f"  PNG: {output_path}.png")
print(f"  PDF: {output_path}.pdf")
