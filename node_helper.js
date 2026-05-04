"use strict";

/* Magic Mirror
 * Module: MMM-Todoist
 *
 * By Chris Brooker
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const crypto = require("crypto");

let axios;
let showdown;

try {
	axios = require("axios");
} catch (e) {
	axios = null;
	console.error("MMM-Todoist: missing dependency 'axios'. Run 'npm install' in the module folder.", e && e.message);
}

try {
	showdown = require("showdown");
} catch (e) {
	showdown = null;
	console.error("MMM-Todoist: missing dependency 'showdown'. Run 'npm install' in the module folder.", e && e.message);
}

module.exports = NodeHelper.create({
	start: function() {
		console.log("Starting node helper for: " + this.name);
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "FETCH_TODOIST") {
			this.config = payload;
			this.fetchTodos();
		} else if (notification === "TODOIST_CLOSE_TASK") {
			this.closeTask(payload);
		}
	},

	closeTask: function(payload) {
		var self = this;
		var taskId = payload.taskId;
		var accessToken = payload.accessToken;

		if (!axios) {
			console.error("MMM-Todoist: axios is not available. Cannot close task.");
			self.sendSocketNotification("CLOSE_TASK_ERROR", {
				taskId: taskId,
				error: "Missing dependency: axios"
			});
			return;
		}

		if (!accessToken) {
			console.error("MMM-Todoist: AccessToken not set, cannot close task.");
			self.sendSocketNotification("CLOSE_TASK_ERROR", {
				taskId: taskId,
				error: "AccessToken not configured"
			});
			return;
		}

		var command = {
			type: "item_complete",
			uuid: crypto.randomUUID(),
			args: {
				id: taskId
			}
		};
		var url = (this.config && this.config.apiBase ? this.config.apiBase : "https://api.todoist.com/api") +
			"/" + (this.config && this.config.apiVersion ? this.config.apiVersion : "v1") + "/sync";
		var params = new URLSearchParams();
		params.append("commands", JSON.stringify([command]));

		axios.post(url, params.toString(), {
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"Authorization": "Bearer " + accessToken
			}
		})
		.then(function(response) {
			if (!self.syncCommandSucceeded(response.data, command.uuid)) {
				throw new Error("Sync command failed: " + JSON.stringify(response.data && response.data.sync_status));
			}

			console.log("MMM-Todoist: Task " + taskId + " closed successfully.");
			self.sendSocketNotification("TASK_CLOSED", { taskId: taskId });
		})
		.catch(function(error) {
			var errorMessage = "Unknown error";
			if (error.response) {
				errorMessage = "API Error: " + error.response.status;
				console.error("MMM-Todoist: Failed to close task " + taskId + ":", error.response.status, error.response.data);
			} else if (error.request) {
				errorMessage = "No response from Todoist API: " + error.message;
				console.error("MMM-Todoist: No response closing task " + taskId + ":", error.message);
			} else {
				errorMessage = "Request error: " + error.message;
				console.error("MMM-Todoist: Error closing task " + taskId + ":", error.message);
			}
			self.sendSocketNotification("CLOSE_TASK_ERROR", {
				taskId: taskId,
				error: errorMessage
			});
		});
	},

	syncCommandSucceeded: function(data, commandUuid) {
		return data && data.sync_status && data.sync_status[commandUuid] === "ok";
	},

	addContentHtml: function(items) {
		let markdownConverter = null;
		if (showdown) {
			markdownConverter = new showdown.Converter();
		}

		items.forEach((item) => {
			if (item.content) {
				if (markdownConverter) {
					item.contentHtml = markdownConverter.makeHtml(item.content);
				} else {
					item.contentHtml = item.content;
				}
			}
		});
	},

	getTodayCompletionRange: function() {
		var now = new Date();
		var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

		return {
			since: start.toISOString(),
			until: end.toISOString()
		};
	},

	getCompletedTodosUrl: function() {
		return this.config.apiBase + "/" + this.config.apiVersion + "/" + this.config.completedTodoistEndpoint;
	},

	fetchCompletedTodosToday: function(accessCode) {
		var self = this;
		var completionRange = self.getTodayCompletionRange();
		var completedItems = [];

		var fetchPage = function(cursor) {
			var requestParams = {
				since: completionRange.since,
				until: completionRange.until
			};

			if (cursor) {
				requestParams.cursor = cursor;
			}

			return axios.get(self.getCompletedTodosUrl(), {
				headers: {
					"cache-control": "no-cache",
					"Authorization": "Bearer " + accessCode
				},
				params: requestParams
			})
			.then(function(response) {
				if (self.config.debug) {
					console.log("MMM-Todoist Completed API Response:", JSON.stringify(response.data, null, 2));
				}

				if (response.status !== 200 || !response.data || !Array.isArray(response.data.items)) {
					throw new Error("Invalid completed tasks response");
				}

				completedItems = completedItems.concat(response.data.items);
				if (response.data.next_cursor) {
					return fetchPage(response.data.next_cursor);
				}

				return completedItems.map(function(item) {
					item.is_completed = true;
					item.checked = true;
					if (!item.completed_at) {
						item.completed_at = completionRange.since;
					}
					return item;
				});
			});
		};

		return fetchPage();
	},

	mergeCompletedTodos: function(taskJson, completedItems) {
		var itemsById = {};

		taskJson.items.forEach(function(item) {
			itemsById[item.id] = item;
		});

		completedItems.forEach(function(item) {
			itemsById[item.id] = item;
		});

		taskJson.items = Object.keys(itemsById).map(function(id) {
			return itemsById[id];
		});
	},

	fetchTodos : function() {
		var self = this;
		var accessCode = self.config.accessToken;

		if (!axios) {
			console.error("MMM-Todoist: axios is not available. Please run 'npm install' in modules/MMM-Todoist");
			self.sendSocketNotification("FETCH_ERROR", { error: "Missing dependency: axios" });
			return;
		}
		
		if (!accessCode || accessCode === "") {
			console.error("MMM-Todoist: AccessToken not set!");
			self.sendSocketNotification("FETCH_ERROR", {
				error: "AccessToken not configured"
			});
			return;
		}

		var url = self.config.apiBase + "/" + self.config.apiVersion + "/" + self.config.todoistEndpoint;
		var params = new URLSearchParams();
		params.append("sync_token", "*");
		params.append("resource_types", self.config.todoistResourceType);

		axios.post(url, params.toString(), {
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				"cache-control": "no-cache",
				"Authorization": "Bearer " + accessCode
			}
		})
		.then(function(response) {
			if (self.config.debug) {
				console.log("MMM-Todoist API Response:", JSON.stringify(response.data, null, 2));
			}

			if (response.status === 200 && response.data) {
				var taskJson = response.data;
				
				if (!taskJson.items || !Array.isArray(taskJson.items)) {
					console.error("MMM-Todoist: Invalid response format - items array missing");
					self.sendSocketNotification("FETCH_ERROR", {
						error: "Invalid response format"
					});
					return;
				}

				var sendTasks = function() {
					self.addContentHtml(taskJson.items);
					taskJson.accessToken = accessCode;
					self.sendSocketNotification("TASKS", taskJson);
				};

				if (self.config.showComplete === true) {
					self.fetchCompletedTodosToday(accessCode)
						.then(function(completedItems) {
							self.mergeCompletedTodos(taskJson, completedItems);
							sendTasks();
						})
						.catch(function(error) {
							self.handleFetchError(error);
						});
				} else {
					sendTasks();
				}
			} else {
				console.error("MMM-Todoist: Unexpected response status: " + response.status);
				self.sendSocketNotification("FETCH_ERROR", {
					error: "Unexpected response status: " + response.status
				});
			}
		})
		.catch(function(error) {
			self.handleFetchError(error);
		});
	},

	handleFetchError: function(error) {
		var errorMessage = "Unknown error";
		if (error.response) {
			// The request was made and the server responded with a status code
			// that falls out of the range of 2xx
			errorMessage = "API Error: " + error.response.status + " - " + (error.response.data ? JSON.stringify(error.response.data) : error.message);
			console.error("MMM-Todoist API Error:", error.response.status, error.response.data);
		} else if (error.request) {
			// The request was made but no response was received
			errorMessage = "No response from Todoist API: " + error.message;
			console.error("MMM-Todoist: No response received:", error.message);
		} else {
			// Something happened in setting up the request that triggered an Error
			errorMessage = "Request setup error: " + error.message;
			console.error("MMM-Todoist Request Error:", error.message);
		}

		this.sendSocketNotification("FETCH_ERROR", {
			error: errorMessage
		});
	}
});