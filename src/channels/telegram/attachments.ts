import { basename } from "node:path";
import { downloadRemoteBuffer } from "../../agents/attachments/download.ts";
import { saveWorkspaceAttachment } from "../../agents/attachments/storage.ts";
import { callTelegramApi } from "./api.ts";
import type { TelegramFileDocument, TelegramMessage, TelegramPhotoSize } from "./message.ts";

type TelegramGetFileResult = {
  file_path?: string;
};

function pickTelegramPhoto(photo: TelegramPhotoSize[] | undefined) {
  if (!Array.isArray(photo) || photo.length === 0) {
    return undefined;
  }

  return [...photo].sort((left, right) => (right.file_size ?? 0) - (left.file_size ?? 0))[0];
}

async function downloadTelegramAttachment(params: {
  botToken: string;
  fileId: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
  originalFilename?: string;
  contentType?: string;
  defaultBaseName: string;
}) {
  const fileInfo = await callTelegramApi<TelegramGetFileResult>(
    params.botToken,
    "getFile",
    {
      file_id: params.fileId,
    },
  );
  if (!fileInfo.file_path) {
    return null;
  }

  const fileUrl = `https://api.telegram.org/file/bot${params.botToken}/${fileInfo.file_path}`;
  const downloaded = await downloadRemoteBuffer({ url: fileUrl });
  return saveWorkspaceAttachment({
    workspacePath: params.workspacePath,
    sessionKey: params.sessionKey,
    messageId: params.messageId,
    buffer: downloaded.buffer,
    originalFilename:
      params.originalFilename || basename(fileInfo.file_path),
    contentType: resolveTelegramAttachmentContentType({
      downloadedContentType: downloaded.contentType,
      fallbackContentType: params.contentType,
    }),
    defaultBaseName: params.defaultBaseName,
  });
}

function resolveTelegramAttachmentContentType(params: {
  downloadedContentType?: string;
  fallbackContentType?: string;
}) {
  const downloaded = params.downloadedContentType?.split(";")[0]?.trim().toLowerCase();
  if (!downloaded || downloaded === "application/octet-stream") {
    return params.fallbackContentType ?? params.downloadedContentType;
  }
  return params.downloadedContentType;
}

export async function resolveTelegramAttachmentPaths(params: {
  message: TelegramMessage;
  botToken: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const attachmentPaths: string[] = [];

  const messages = resolveTelegramAttachmentMessages(params.message);
  for (const message of messages) {
    const paths = await resolveTelegramSingleMessageAttachmentPaths({
      ...params,
      message,
    });
    attachmentPaths.push(...paths);
  }

  return attachmentPaths;
}

function resolveTelegramAttachmentMessages(message: TelegramMessage) {
  const messages = message.media_group_messages;
  return Array.isArray(messages) && messages.length > 0 ? messages : [message];
}

async function resolveTelegramSingleMessageAttachmentPaths(params: {
  message: TelegramMessage;
  botToken: string;
  workspacePath: string;
  sessionKey: string;
  messageId: string;
}) {
  const attachmentPaths: string[] = [];

  const document = params.message.document;
  if (document?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: document.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: document.file_name,
        contentType: document.mime_type,
        defaultBaseName: "telegram-document",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram document download failed", error);
    }
  }

  const photo = pickTelegramPhoto(params.message.photo);
  if (photo?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: photo.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        defaultBaseName: "telegram-photo",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram photo download failed", error);
    }
  }

  const voice = params.message.voice;
  if (voice?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: voice.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        contentType: voice.mime_type ?? "audio/ogg",
        defaultBaseName: "telegram-voice",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram voice download failed", error);
    }
  }

  const audio = params.message.audio;
  if (audio?.file_id) {
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: audio.file_id,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: audio.file_name,
        contentType: audio.mime_type,
        defaultBaseName: "telegram-audio",
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error("telegram audio download failed", error);
    }
  }

  // Videos, round video notes and GIF animations. Before 2026-09-27 none of these were
  // downloaded, so a video sent to an agent silently arrived as an empty message. The
  // Bot API caps getFile downloads at 20 MB; a larger video fails here and is logged,
  // which is the same failure mode every other attachment kind already has.
  const videoLike: Array<{ fileId?: string; fileName?: string; mimeType?: string; base: string }> = [
    {
      fileId: params.message.video?.file_id,
      fileName: params.message.video?.file_name,
      mimeType: params.message.video?.mime_type ?? "video/mp4",
      base: "telegram-video",
    },
    {
      fileId: params.message.video_note?.file_id,
      mimeType: "video/mp4",
      base: "telegram-video-note",
    },
    {
      // A GIF also arrives as `document`, which the block above already saved.
      fileId: params.message.document ? undefined : params.message.animation?.file_id,
      fileName: params.message.animation?.file_name,
      mimeType: params.message.animation?.mime_type ?? "video/mp4",
      base: "telegram-animation",
    },
  ];
  for (const item of videoLike) {
    if (!item.fileId) {
      continue;
    }
    try {
      const filePath = await downloadTelegramAttachment({
        botToken: params.botToken,
        fileId: item.fileId,
        workspacePath: params.workspacePath,
        sessionKey: params.sessionKey,
        messageId: params.messageId,
        originalFilename: item.fileName,
        contentType: item.mimeType,
        defaultBaseName: item.base,
      });
      if (filePath) {
        attachmentPaths.push(filePath);
      }
    } catch (error) {
      console.error(`${item.base} download failed`, error);
    }
  }

  return attachmentPaths;
}
