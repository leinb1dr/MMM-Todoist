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
		} else if (notification === "TODOIST_UNCOMPLETE_TASK") {
			this.uncompleteTask(payload);
		}
	},

	closeTask: function(payload) {
		this.sendTaskCommand(payload, {
			commandType: "item_complete",
			actionName: "close",
			actionPastTense: "closed",
			actionGerund: "closing",
			successNotification: "TASK_CLOSED",
			errorNotification: "CLOSE_TASK_ERROR"
		});
	},

	uncompleteTask: function(payload) {
		this.sendTaskCommand(payload, {
			commandType: "item_uncomplete",
			actionName: "uncomplete",
			actionPastTense: "uncompleted",
			actionGerund: "uncompleting",
			successNotification: "TASK_UNCOMPLETED",
			errorNotification: "UNCOMPLETE_TASK_ERROR"
		});
	},

	sendTaskCommand: function(payload, options) {
		var self = this;
		var taskId = payload.taskId;
		var accessToken = payload.accessToken;

		if (!axios) {
			console.error("MMM-Todoist: axios is not available. Cannot " + options.actionName + " task.");
			self.sendSocketNotification(options.errorNotification, {
				taskId: taskId,
				error: "Missing dependency: axios"
			});
			return;
		}

		if (!accessToken) {
			console.error("MMM-Todoist: AccessToken not set, cannot " + options.actionName + " task.");
			self.sendSocketNotification(options.errorNotification, {
				taskId: taskId,
				error: "AccessToken not configured"
			});
			return;
		}

		var command = {
			type: options.commandType,
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

			console.log("MMM-Todoist: Task " + taskId + " " + options.actionPastTense + " successfully.");
			self.sendSocketNotification(options.successNotification, { taskId: taskId });
		})
		.catch(function(error) {
			var errorMessage = "Unknown error";
			if (error.response) {
				errorMessage = "API Error: " + error.response.status;
				console.error("MMM-Todoist: Failed to " + options.actionName + " task " + taskId + ":", error.response.status, error.response.data);
			} else if (error.request) {
				errorMessage = "No response from Todoist API: " + error.message;
				console.error("MMM-Todoist: No response " + options.actionGerund + " task " + taskId + ":", error.message);
			} else {
				errorMessage = "Request error: " + error.message;
				console.error("MMM-Todoist: Error " + options.actionGerund + " task " + taskId + ":", error.message);
			}
			self.sendSocketNotification(options.errorNotification, {
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

				self.addContentHtml(taskJson.items);
				taskJson.accessToken = accessCode;
				self.sendSocketNotification("TASKS", taskJson);
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