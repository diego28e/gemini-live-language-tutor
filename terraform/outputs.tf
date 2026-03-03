output "cloud_run_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "The URL on which the deployed service is available"
}

output "database_connection_name" {
  value       = google_sql_database_instance.main.connection_name
  description = "The connection name of the master instance to be used in connection strings"
}

output "database_public_ip" {
  value       = google_sql_database_instance.main.public_ip_address
  description = "The public IP address of the database instance"
}
