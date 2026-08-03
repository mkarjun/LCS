package io.github.hectorvent.floci.cloudshell;

import com.github.dockerjava.api.DockerClient;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

/**
 * Moves files between the browser and a session's container, backing CloudShell's
 * "Upload file" and "Download file" actions.
 *
 * <p>The Docker API only copies tar archives in and out, so a single file is wrapped on
 * the way in and unwrapped on the way out.
 */
@ApplicationScoped
public class CloudShellFiles {

    private final DockerClient dockerClient;

    @Inject
    public CloudShellFiles(DockerClient dockerClient) {
        this.dockerClient = dockerClient;
    }

    /**
     * Writes {@code content} to {@code fileName} in the session's home directory.
     *
     * @throws CloudShellSessionManager.CloudShellException if the name is not a plain file name
     */
    public void upload(CloudShellSession session, String homeDirectory, String fileName, byte[] content) {
        String safeName = requirePlainFileName(fileName);
        byte[] archive = tar(safeName, content);
        dockerClient.copyArchiveToContainerCmd(session.containerId())
                .withTarInputStream(new ByteArrayInputStream(archive))
                .withRemotePath(homeDirectory)
                .exec();
    }

    /** Reads a single file out of the container. Directories are rejected. */
    public byte[] download(CloudShellSession session, String path) {
        if (path == null || path.isBlank()) {
            throw new CloudShellSessionManager.CloudShellException("A file path is required.");
        }
        try (InputStream tarStream = dockerClient
                .copyArchiveFromContainerCmd(session.containerId(), path).exec();
             TarArchiveInputStream tar = new TarArchiveInputStream(tarStream)) {
            TarArchiveEntry entry = tar.getNextEntry();
            while (entry != null) {
                if (!entry.isDirectory()) {
                    return tar.readAllBytes();
                }
                entry = tar.getNextEntry();
            }
            throw new CloudShellSessionManager.CloudShellException(
                    "No file at " + path + " (a directory cannot be downloaded).");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * Uploads land in the home directory only. A name carrying a path separator or a
     * {@code ..} segment would let an upload write anywhere in the container filesystem,
     * including over a binary on {@code PATH}.
     */
    static String requirePlainFileName(String fileName) {
        if (fileName == null || fileName.isBlank()) {
            throw new CloudShellSessionManager.CloudShellException("A file name is required.");
        }
        String trimmed = fileName.strip();
        if (trimmed.contains("/") || trimmed.contains("\\") || trimmed.equals(".") || trimmed.equals("..")) {
            throw new CloudShellSessionManager.CloudShellException(
                    "Upload file names must be a plain file name, not a path: " + fileName);
        }
        return trimmed;
    }

    private static byte[] tar(String fileName, byte[] content) {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (TarArchiveOutputStream tar = new TarArchiveOutputStream(buffer)) {
            tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX);
            TarArchiveEntry entry = new TarArchiveEntry(fileName);
            entry.setSize(content.length);
            entry.setMode(0644);
            tar.putArchiveEntry(entry);
            tar.write(content);
            tar.closeArchiveEntry();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return buffer.toByteArray();
    }
}
