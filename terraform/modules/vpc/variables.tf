variable "environment" {
  description = "The environment name (eg., staging, production)"
  type = string
}

variable "vpc_cidr" {
  description = "The CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16" # This gives us an isolated network with 65,536 possible IP addresses
}