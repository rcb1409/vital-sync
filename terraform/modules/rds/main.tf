# 1. Subnet Group
resource "aws_db_subnet_group" "main" {
    name = "${var.environment}-vitalsync-db-subnet-group"
    subnet_ids = var.private_subnet_ids

    tags = {
        Name = "${var.environment}-vitalsync-db-subnet-group"
        Environment = var.environment
    }
}


# 2. Security Group (Firewall)
resource "aws_security_group" "rds" {
    name = "${var.environment}-vitalsync-rds-sg"
    description = "Allow MySQL inbound traffic from VPC"
    vpc_id = var.vpc_id

    ingress {
        description = "MySQL from VPC"
        from_port = 3306
        to_port = 3306
        protocol = "tcp"
        cidr_block = ["10.0.0.0/16"]
    }
    egress {
        from_port = 0
        to_port = 0
        protocol = "-1"
        cidr_blocks = ["0.0.0.0/0"] 
    }

    tags = {
    Name = "${var.environment}-vitalsync-rds-sg"
    Environment = var.environment
    }
}

# 3. The Database Instance
resource "aws_db_instance" "main" {
  identifier           = "${var.environment}-vitalsync-db"
  engine               = "mysql"
  engine_version       = "8.0"
  instance_class       = "db.t4g.micro" # AWS Free Tier eligible!
  allocated_storage    = 20
  
  db_name              = "vitalsync"    # Initial database name
  username             = "admin"        # Master username
  password             = "vitalsync_admin_pass_123" # Don't worry, we'll secure this later!
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  
  skip_final_snapshot    = true # If we delete the DB, don't take a backup (saves money in dev)
  publicly_accessible    = false # CRITICAL: Do not give this a public IP address!
  tags = {
    Name        = "${var.environment}-vitalsync-db"
    Environment = var.environment
  }
}