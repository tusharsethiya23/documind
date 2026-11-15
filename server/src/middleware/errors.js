import mongoose from 'mongoose';
import multer from 'multer';

/** An error with an HTTP status, safe to show to the client. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Reject malformed :id params before they reach Mongo. */
export function validateId(req, _res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return next(new HttpError(400, 'Invalid document id.'));
  next();
}

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'Not found.'));
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status ?? 500;
  let message = err.message;

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Request body is not valid JSON.';
  } else if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on the server.';
  }

  if (res.headersSent) return res.end(); // e.g. mid-stream; nothing else we can send
  res.status(status).json({ error: message });
}
