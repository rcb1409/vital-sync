variable "environment" {
    description = "The environment name"
    type = string
}

variable "vpc_id" {
    description = "The ID of the VPC where the DB will live"
    type = string
}

variable "private_subnet_ids" {
    description = "The IDs of the private subnets for the DB"
    type = list(string)
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Master password for the RDS instance"
  type        = string
  sensitive   = true
}
