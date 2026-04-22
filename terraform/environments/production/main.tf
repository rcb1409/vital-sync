variable "db_username" {
  type      = string
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}

# 1. AWS Provider Setup
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1" # US East (N. Virginia)
}


# 2. Deploying the Network
module "vpc" {
  source      = "../../modules/vpc"
  environment = "production"
  vpc_cidr    = "10.0.0.0/16"
}

# 3. Deploying the Database 
module "rds" {
  source             = "../../modules/rds"
  environment        = "production"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  db_username        = var.db_username
  db_password        = var.db_password
}

# 4. Deploying the Cache
module "elasticache" {
  source             = "../../modules/elasticache"
  environment        = "production"
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
}

# Fetch the ARN of our Secrets Manager secret (created once manually in the AWS Console)
data "aws_secretsmanager_secret" "api" {
  name = "production/vitalsync/api"
}

# 5. Deploying the Express Server & Load Balancer
module "ecs" {
  source             = "../../modules/ecs"
  environment        = "production"
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  secrets_arn        = data.aws_secretsmanager_secret.api.arn
}

# 6. Generate free SSL Certificate (ACM)
resource "aws_acm_certificate" "cert" {
  domain_name       = "vitalsync.ravibollepalli.me"
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# 7. Deploy Frontend (S3 + CloudFront)
module "frontend" {
  source          = "../../modules/s3_cloudfront"
  environment     = "production"
  domain_name     = "vitalsync.ravibollepalli.me"
  certificate_arn = aws_acm_certificate.cert.arn
  alb_dns_name    = module.ecs.alb_dns_name # Notice how we use the output from the backend ECS module!
}

# 8. Outputs (These will be printed to your terminal after deployment!)
output "certificate_validation_records" {
  description = "🚨 IMPORTANT: Paste these into Namecheap's DNS settings!"
  value = [
    for dvo in aws_acm_certificate.cert.domain_validation_options : {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  ]
}

# 9. ECR Repository for Docker Images
resource "aws_ecr_repository" "backend" {
  name                 = "vitalsync-backend"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}



# 10. OIDC Identity Provider (Tells AWS: "Trust GitHub as an identity source")
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  # This is GitHub's official audience and thumbprint — do not change these values!
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# 11. The IAM Role that GitHub pipelines will assume
resource "aws_iam_role" "github_actions" {
  name = "vitalsync-github-actions-role"

  # The Trust Policy: defines WHO is allowed to assume this role.
  # We are restricting it to ONLY your specific GitHub repository!
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          # 🚨 IMPORTANT: Replace YOUR_GITHUB_USERNAME with your actual GitHub username!
          "token.actions.githubusercontent.com:sub" = "repo:rcb1409/vital-sync:*"
        }
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

# Grant AdministratorAccess to the role
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Output the Role ARN — we will paste this into our GitHub Actions workflow files!
output "github_actions_role_arn" {
  description = "Paste this ARN into your GitHub Actions workflows under role-to-assume"
  value       = aws_iam_role.github_actions.arn
}

output "cloudfront_url" {
  description = "The CloudFront domain — add this as a CNAME for vitalsync.ravibollepalli.me"
  value       = module.frontend.cloudfront_domain_name
}
