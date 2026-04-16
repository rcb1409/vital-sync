# 1. Subnet Group for Redis
resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.environment}-vitalsync-redis-subnet-group"
  subnet_ids = var.private_subnet_ids
}

# 2. Security Group (Firewall)
resource "aws_security_group" "redis" {
  name        = "${var.environment}-vitalsync-redis-sg"
  description = "Allow Redis inbound traffic from VPC"
  vpc_id      = var.vpc_id
  ingress {
    description = "Redis from VPC"
    from_port   = 6379 # The default Redis port!
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Only allow traffic from within our VPC!
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 3. Redis Cluster
resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${var.environment}-vitalsync-redis"
  engine               = "redis"
  node_type            = "cache.t4g.micro" # AWS Free Tier eligible!
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
}