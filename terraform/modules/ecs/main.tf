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


# 5. The Task Definition (The blueprint for our container)
resource "aws_ecs_task_definition" "api" {
  family                   = "${var.environment}-vitalsync-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256 # 0.25 vCPU
  memory                   = 512 # 512 MB RAM
  execution_role_arn       = aws_iam_role.execution_role.arn
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
      # ECS fetches each key from Secrets Manager and injects it as an env var
      # before the container process starts — app sees normal process.env.DATABASE_URL etc.
      secrets = [
        { name = "DATABASE_URL",         valueFrom = "${var.secrets_arn}:DATABASE_URL::" },
        { name = "JWT_ACCESS_SECRET",    valueFrom = "${var.secrets_arn}:JWT_ACCESS_SECRET::" },
        { name = "JWT_REFRESH_SECRET",   valueFrom = "${var.secrets_arn}:JWT_REFRESH_SECRET::" },
        { name = "STRAVA_CLIENT_ID",     valueFrom = "${var.secrets_arn}:STRAVA_CLIENT_ID::" },
        { name = "STRAVA_CLIENT_SECRET", valueFrom = "${var.secrets_arn}:STRAVA_CLIENT_SECRET::" },
        { name = "GEMINI_API_KEY",       valueFrom = "${var.secrets_arn}:GEMINI_API_KEY::" }
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
  name            = "${var.environment}-vitalsync-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"
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