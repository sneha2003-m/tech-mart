function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

module.exports = { asyncRoute, httpError, isPositiveInteger };
