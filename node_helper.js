"use strict";

/* Magic Mirror
 * Module: MMM-Todoist
 *
 * By Chris Brooker
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");

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

		var url = "https://api.todoist.com/api/v1/tasks/" + taskId + "/close";

		axios.post(url, null, {
			headers: {
				"Authorization": "Bearer " + accessToken
			}
		})
		.then(function(response) {
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

	todayDateString: function(offsetDays) {
		var date = new Date();
		date.setDate(date.getDate() + (offsetDays || 0));
		var month = String(date.getMonth() + 1).padStart(2, "0");
		var day = String(date.getDate()).padStart(2, "0");
		return date.getFullYear() + "-" + month + "-" + day;
	},

	todayBoundaryISOString: function(offsetDays) {
		var date = new Date();
		date.setHours(0, 0, 0, 0);
		date.setDate(date.getDate() + (offsetDays || 0));
		return date.toISOString();
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

	getCompletedItemsFromResponse: function(data) {
		if (Array.isArray(data)) {
			return data;
		}

		if (data && Array.isArray(data.items)) {
			return data.items;
		}

		if (data && Array.isArray(data.tasks)) {
			return data.tasks;
		}

		if (data && Array.isArray(data.results)) {
			return data.results;
		}

		return [];
	},

	isCompletedToday: function(item) {
		var completedAt = item.completed_at || item.completed_date || item.completedAt;
		if (!completedAt) {
			return false;
		}

		var completedDate = new Date(completedAt);
		if (isNaN(completedDate.getTime())) {
			return false;
		}

		var today = new Date();
		return completedDate.getFullYear() === today.getFullYear() &&
			completedDate.getMonth() === today.getMonth() &&
			completedDate.getDate() === today.getDate();
	},

	normalizeCompletedItem: function(item) {
		var normalized = Object.assign({}, item);
		normalized.id = item.id || item.task_id || item.item_id;
		normalized.content = item.content || item.task_content || item.name || "";
		normalized.project_id = item.project_id || (item.project && item.project.id);
		normalized.labels = item.labels || [];
		normalized.priority = item.priority || 1;
		normalized.child_order = item.child_order || 0;
		normalized.parent_id = item.parent_id || null;
		normalized.due = item.due || null;
		normalized.is_completed = true;
		normalized.completed_at = item.completed_at || item.completed_date || item.completedAt;
		return normalized;
	},

	fetchCompletedTodos: function(accessCode) {
		var self = this;
		var completedUrl = self.config.apiBase + "/" + self.config.apiVersion + "/tasks/completed/by_completion_date";

		return axios.get(completedUrl, {
			headers: {
				"cache-control": "no-cache",
				"Authorization": "Bearer " + accessCode
			},
			params: {
				since: self.todayBoundaryISOString(),
				until: self.todayBoundaryISOString(1)
			}
		})
		.then(function(response) {
			if (self.config.debug) {
				console.log("MMM-Todoist Completed API Response:", JSON.stringify(response.data, null, 2));
			}

			return self.getCompletedItemsFromResponse(response.data)
				.filter(function(item) {
					return self.isCompletedToday(item);
				})
				.map(function(item) {
					return self.normalizeCompletedItem(item);
				})
				.filter(function(item) {
					return item.id;
				});
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

				var completedRequest = Promise.resolve([]);
				if (self.config.showComplete === true) {
					completedRequest = self.fetchCompletedTodos(accessCode);
				}

				completedRequest.then(function(completedItems) {
					taskJson.items = taskJson.items.concat(completedItems);
					self.addContentHtml(taskJson.items);
					taskJson.accessToken = accessCode;
					self.sendSocketNotification("TASKS", taskJson);
				})
				.catch(function(error) {
					self.handleFetchError(error);
				});
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