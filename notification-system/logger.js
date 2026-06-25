// Logging Middleware - Reusable Logger
const logger = {
  _format(level, message, meta = {}) {
    const log = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...meta,
    };
    console.log(JSON.stringify(log));
    return log;
  },

  success(message, meta = {}) {
    return this._format("SUCCESS", message, meta);
  },

  error(message, meta = {}) {
    return this._format("ERROR", message, meta);
  },

  warning(message, meta = {}) {
    return this._format("WARNING", message, meta);
  },

  info(message, meta = {}) {
    return this._format("INFO", message, meta);
  },
};

module.exports = logger;