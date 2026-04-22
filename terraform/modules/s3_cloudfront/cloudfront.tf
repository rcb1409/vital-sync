# 1. Origin Access Control (OAC)
# This acts as CloudFront's secure "keycard" to enter the private S3 bucket.
resource "aws_cloudfront_origin_access_control" "default" {
  name                              = "${var.environment}-vitalsync-oac"
  description                       = "OAC for React App"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# 2. CloudFront CDN Distribution
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled    = true
  default_root_object = "index.html"
  aliases             = [var.domain_name]
  
  # Note: When we get an SSL cert, we will update this to use your custom domain!

  # Origin 1: S3 Bucket (Frontend)
  origin {
    domain_name              = aws_s3_bucket.react_app.bucket_regional_domain_name
    origin_id                = "S3Origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.default.id
  }

  # Origin 2: Application Load Balancer (Backend)
  origin {
    domain_name = var.alb_dns_name
    origin_id   = "ALBOrigin"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # Our ALB only accepts HTTP right now
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Route 1: Backend Traffic (/api/*)
  ordered_cache_behavior {
    path_pattern     = "/api/*"
    target_origin_id = "ALBOrigin"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    
    # AWS Managed Policies (Pass headers through, but DO NOT cache API data)
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
    
    viewer_protocol_policy = "redirect-to-https"
  }
  
  # Route 2: GraphQL Traffic (/graphql)
  ordered_cache_behavior {
    path_pattern     = "/graphql"
    target_origin_id = "ALBOrigin"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
    viewer_protocol_policy = "redirect-to-https"
  }

  # Route 3: Frontend Traffic (Everything else -> S3)
  default_cache_behavior {
    target_origin_id = "S3Origin"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    
    cache_policy_id  = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
  }

  # CRITICAL: React Router Fix
  # If someone goes to /workouts directly, S3 returns a 403 Access Denied because that file doesn't exist.
  # This intercepts 403s and returns index.html gracefully so React Router takes over!
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }
  
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = {
    Name        = "${var.environment}-vitalsync-cdn"
    Environment = var.environment
  }
}
