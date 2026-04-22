variable "environment" {
  type = string
}
variable "domain_name" {
  type = string
}

variable "alb_dns_name" {
  description = "The DNS name of the ALB to route /api traffic to"
  type        = string
}

variable "certificate_arn" {
  description = "The ARN of the ACM SSL certificate for the custom domain"
  type        = string
}