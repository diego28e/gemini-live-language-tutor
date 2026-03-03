variable "project_id" {
  type        = string
  description = "The Google Cloud Project ID"
  default     = "ai-tutor-hackathon-123"
}

variable "region" {
  type        = string
  description = "The target region"
  default     = "us-central1"
}

variable "backend_image" {
  type        = string
  description = "The Docker image for the backend service"
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
