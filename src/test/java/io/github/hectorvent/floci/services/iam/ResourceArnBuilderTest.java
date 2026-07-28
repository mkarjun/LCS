package io.github.hectorvent.floci.services.iam;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.UriInfo;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.when;

class ResourceArnBuilderTest {

    private final ResourceArnBuilder builder = new ResourceArnBuilder();

    @Test
    void buildsWildcardArnForInternalS3RootAlias() {
        ContainerRequestContext ctx = mockCtx("/__s3_root__");

        assertEquals("arn:aws:s3:::*", builder.build("s3", ctx, "us-east-1", "000000000000"));
    }

    @Test
    void buildsBucketArnForBucketPath() {
        ContainerRequestContext ctx = mockCtx("/example-bucket");

        assertEquals("arn:aws:s3:::example-bucket", builder.build("s3", ctx, "us-east-1", "000000000000"));
    }

    private static ContainerRequestContext mockCtx(String path) {
        ContainerRequestContext ctx = Mockito.mock(ContainerRequestContext.class);
        UriInfo uriInfo = Mockito.mock(UriInfo.class);
        when(uriInfo.getPath()).thenReturn(path);
        when(ctx.getUriInfo()).thenReturn(uriInfo);
        return ctx;
    }
}