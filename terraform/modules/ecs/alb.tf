# 1. Security Group for the Load Balancer
resource "aws_security_group" "alb" {
  name        = "${var.environment}-vitalsync-alb-sg"
  description = "Allow inbound HTTP/HTTPS traffic to ALB"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Open to the entire internet!
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}


# 2. The Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.environment}-vitalsync-alb"
  internal           = false # Important: It must face the internet
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids # Lives in the public subnets
}

# 3. The Target Group (The bridge between the ALB and our Express server)
resource "aws_lb_target_group" "api" {
  name        = "${var.environment}-vitalsync-tg"
  port        = 4000 # Your Express server runs on 4000!
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # Required for Fargate
  health_check {
    path                = "/api/health" # We check this endpoint!
    healthy_threshold   = 2
    unhealthy_threshold = 10
  }
}
# 4. The Listener (The code that actually receives the request and forwards it)
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
