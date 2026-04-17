# 1. The S3 Bucket (Our Hard Drive)
resource "aws_s3_bucket" "react_app" {
  bucket = "${var.environment}-vitalsync-frontend"
  tags = {
    Name        = "${var.environment}-vitalsync-frontend"
    Environment = var.environment
  }
}

# 2. Block Public Access (Security)
resource "aws_s3_bucket_public_access_block" "react_app" {
  bucket                  = aws_s3_bucket.react_app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}


# 3. Bucket Policy (Allowing CloudFront)
# This acts as a VIP pass, allowing ONLY our CloudFront CDN to read the files.
data "aws_iam_policy_document" "s3_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.react_app.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn" # We'll create this CloudFront distribution next!
      values   = [aws_cloudfront_distribution.cdn.arn] 
    }
  }
}
resource "aws_s3_bucket_policy" "react_app" {
  bucket = aws_s3_bucket.react_app.id
  policy = data.aws_iam_policy_document.s3_policy.json
}