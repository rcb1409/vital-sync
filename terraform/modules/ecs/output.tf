output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "The public DNS name of the Load Balancer"
}
