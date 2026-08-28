package com.bim.api;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

/** MinIO(S3 호환). path-style 필수, region 은 형식상. */
@Configuration
class S3Config {
	@Bean
	S3Client s3(@Value("${s3.endpoint}") String endpoint,
	            @Value("${s3.access-key}") String key, @Value("${s3.secret-key}") String secret) {
		return S3Client.builder()
			.endpointOverride(URI.create(endpoint))
			.region(Region.US_EAST_1)
			.credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(key, secret)))
			.forcePathStyle(true)
			.build();
	}
}
