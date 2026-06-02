# ECS module — runs the Express API server on Fargate.
# Last infra change: Expanded Bedrock IAM to all US regions (us-east-1/2, us-west-2) for cross-region inference profiles.

# 1. The ECS Cluster
resource "aws_ecs_cluster" "main" {
    name = "${var.environment}-vitalsync-cluster"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.environment}-vitalsync-api"
  retention_in_days = 7
}

# 3. Security Group for the Express Server
resource "aws_security_group" "ecs" {
  name        = "${var.environment}-vitalsync-ecs-sg"
  description = "Security group for Express server"
  vpc_id      = var.vpc_id
  # Only allow traffic that comes strictly from the Load Balancer!
  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 4. The IAM Role (Permissions for the task)
data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution Role — used by ECS *agent* to pull the image and read secrets.
# This is NOT the same as the task role below.
resource "aws_iam_role" "execution_role" {
  name               = "${var.environment}-vitalsync-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}
resource "aws_iam_role_policy_attachment" "execution_role_policy" {
  role       = aws_iam_role.execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Grant the execution role permission to read our app secrets from Secrets Manager
resource "aws_iam_role_policy" "secrets_access" {
  name = "${var.environment}-vitalsync-secrets-policy"
  role = aws_iam_role.execution_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secrets_arn
    }]
  })
}

# Task Role — assumed by the running container process itself.
# This gives our application code permission to call AWS services (Bedrock).
# Distinct from execution_role which is for ECS infra operations.
resource "aws_iam_role" "task_role" {
  name               = "${var.environment}-vitalsync-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy" "bedrock_access" {
  name = "${var.environment}-vitalsync-bedrock-policy"
  role = aws_iam_role.task_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ]
      # Model IDs starting with "us." are cross-region inference profiles.
      # AWS internally routes these requests through ANY US region (us-east-1,
      # us-east-2, us-west-2), so the IAM policy must allow InvokeModel on
      # resources in ALL three regions — otherwise you get a 403 when the
      # request happens to land in us-east-2 or us-west-2.
      #
      # ARN formats:
      #   foundation-model: arn:aws:bedrock:REGION::foundation-model/MODEL
      #   inference-profile: arn:aws:bedrock:REGION:ACCOUNT:inference-profile/MODEL
      Resource = [
        # us-east-1
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-1:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        # us-east-2 (cross-region routing can land here)
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-2:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        # us-west-2 (cross-region routing can land here)
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-west-2:*:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0"
      ]
    }]
  })
}


# 5. The Task Definition (The blueprint for our container)
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-vitalsync-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256 # 0.25 vCPU
  memory                   = 512 # 512 MB RAM
  execution_role_arn       = aws_iam_role.execution_role.arn
  # task_role_arn gives the running container permission to call AWS APIs (Bedrock).
  # Without this, bedrock.InvokeModel will return AccessDeniedException.
  task_role_arn            = aws_iam_role.task_role.arn
  container_definitions = jsonencode([
    {
      name      = "vitalsync-api"
      image     = "placeholder-image-url" # Github Actions will dynamically inject our real Docker Image URL here!
      essential = true
      portMappings = [
        {
          containerPort = 4000
          hostPort      = 4000
        }
      ]
      # Plain-text env vars — non-sensitive configuration.
      # AWS_REGION and BEDROCK_MODEL_ID are not secrets (safe to see in console).
      environment = [
        { name = "NODE_ENV",          value = "production" },
        { name = "PORT",              value = "4000" },
        { name = "AWS_REGION",        value = "us-east-1" },
        { name = "BEDROCK_MODEL_ID",  value = "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
        # US region Langfuse endpoint — keys are registered on us.cloud.langfuse.com, not cloud.langfuse.com (EU).
        { name = "LANGFUSE_BASE_URL", value = "https://us.cloud.langfuse.com" }
      ]
      # ECS fetches each key from Secrets Manager and injects it as an env var
      # before the container process starts — app sees normal process.env.DATABASE_URL etc.
      secrets = [
        { name = "DATABASE_URL",          valueFrom = "${var.secrets_arn}:DATABASE_URL::" },
        { name = "JWT_ACCESS_SECRET",     valueFrom = "${var.secrets_arn}:JWT_ACCESS_SECRET::" },
        { name = "JWT_REFRESH_SECRET",    valueFrom = "${var.secrets_arn}:JWT_REFRESH_SECRET::" },
        { name = "STRAVA_CLIENT_ID",      valueFrom = "${var.secrets_arn}:STRAVA_CLIENT_ID::" },
        { name = "STRAVA_CLIENT_SECRET",  valueFrom = "${var.secrets_arn}:STRAVA_CLIENT_SECRET::" },
        { name = "REDIS_URL",             valueFrom = "${var.secrets_arn}:REDIS_URL::" },
        # Langfuse observability — optional but recommended in production.
        # Add these keys to Secrets Manager before running terraform apply.
        # If missing, Langfuse tracing is silently disabled (app still works).
        { name = "LANGFUSE_PUBLIC_KEY",   valueFrom = "${var.secrets_arn}:LANGFUSE_PUBLIC_KEY::" },
        { name = "LANGFUSE_SECRET_KEY",   valueFrom = "${var.secrets_arn}:LANGFUSE_SECRET_KEY::" },
        # Tavily — web search tool for the AI coach. Optional: if missing, web_search is disabled.
        { name = "TAVILY_API_KEY",        valueFrom = "${var.secrets_arn}:TAVILY_API_KEY::" }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

# 6. The ECS Service (Runs and maintains the Task Definition)
resource "aws_ecs_service" "api" {
  name                 = "${var.environment}-vitalsync-api"
  cluster              = aws_ecs_cluster.main.id
  task_definition      = aws_ecs_task_definition.api.arn
  desired_count        = 1
  launch_type          = "FARGATE"
  force_new_deployment = true # Automatically redeploy when task definition changes
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false # Strictly Private!
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "vitalsync-api"
    container_port   = 4000
  }
}