variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "secrets_arn" {
  type        = string
  description = "ARN of the Secrets Manager secret containing app environment variables"
}