package io.github.hectorvent.floci.cloudshell;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Turns a CloudShell failure into a 400 carrying its message.
 *
 * <p>Every {@link CloudShellSessionManager.CloudShellException} is raised with wording meant
 * for the person at the console — "mount the Docker socket", "session limit reached" — so
 * it is worth surfacing rather than collapsing into a generic 500.
 */
@Provider
public class CloudShellExceptionMapper
        implements ExceptionMapper<CloudShellSessionManager.CloudShellException> {

    @Override
    public Response toResponse(CloudShellSessionManager.CloudShellException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(new CloudShellController.ErrorBody(exception.getMessage()))
                .build();
    }
}
