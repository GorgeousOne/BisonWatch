"use strict";
import * as d3 from "d3";
import { loadBisonDataset, global_settings } from "../../bison.js";


const dataset = "../../data/" + global_settings["most_recent_dataset"]["id"] + ".csv"
const height = 800
const width = 1000

const faculty_colors = new Map()
    .set("Fakultät Architektur und Urbanistik", "#009BB4")
    .set("Fakultät Bau- und Umweltingenieurwissenschaften", "#F39100")
    .set("Fakultät Kunst und Gestaltung", "#94C11C")
    .set("Fakultät Medien", "#006B94")
    .set("Sonstiges", "grey")


let selector_url = undefined;

let lecturers = new Map();
let force_selection = false
let lecturer_selected = false
let lecturer_selected_name = ""
let lecturer_force_selected_name = ""
let zoom = undefined;

let links = undefined;
let nodes = undefined;

let force_map = new Map()

const blacklist = ["N.N", "N.N.", " N.N.", "missing", "keine öffentliche Person", " ", ""];

function parseBisonData(bisond) {
    bisond.forEach(course => {
        course.lecturers.forEach(person => {
            if (blacklist.includes(person.name) || person.name == undefined) {
                return;
            }
            if (!lecturers.has(person.name)) {
                lecturers.set(person.name, {
                    courses: new Set(),
                    colecturers: new Map(),
                    faculty: faculty_colors.has(person.faculty) ? person.faculty : "Sonstiges"
                })
            }
            // update colectureres
            let colecturers = lecturers.get(person.name).colecturers
            course.lecturers.forEach(lecturerB => {
                if (lecturerB.name == person.name || blacklist.includes(lecturerB.name)) {
                    return;
                }
                if (colecturers.has(lecturerB.name)) {
                    colecturers.set(lecturerB.name, colecturers.get(lecturerB.name) + 1)
                } else {
                    colecturers.set(lecturerB.name, 1)
                }
            })
            // update course
            lecturers.get(person.name).courses.add(course)
        });
    });
}

function getSelectorUrl() {
// generate base url to the parralel sets visualisation
    let url = window.location.toString().split("/")
    // pop query string
    url.pop()
    // pop visualiser reference
    url.pop()
    url.push("parallel_sets/")
    url = new URL(url.join("/"))
    return url
}

function createLegend(svg, colors, startX = 10, startY = 25, spacing = 20) {
    // Create legend vertical
    let index = 0;
    for (const [label, color] of colors.entries()) {
        const y = startY + index * spacing;
        svg.append("circle").attr("cx", startX).attr("cy", y).attr("r", 6).style("fill", color);
        svg.append("text").attr("x", startX + 10).attr("y", y + 5).text(label).attr("alignment-baseline", "middle");
        index++;
    };
}

function genGraphData() {
    const graphData = { nodes: [], links: [] };

    lecturers.forEach((person, lecturer_name) => {
        graphData.nodes.push({
            id: lecturer_name,
            group: person.courses.size,
            faculty: person.faculty })
        person.colecturers.forEach((lecture_num, colecturer_name) => {
            if (lecturer_name < colecturer_name) {
                graphData.links.push({
                    source: lecturer_name,
                    target: colecturer_name,
                    value: lecture_num })
            }
        })
    })
    return graphData;
}

// Laden der Bison-Daten
loadBisonDataset(dataset).then((bisond) => {
    selector_url = getSelectorUrl();
    const svg2 = d3.select("#legend")
    createLegend(svg2, faculty_colors);
    parseBisonData(bisond)

    const datalist = d3.select("#search")
    lecturers.forEach((d, lecturer) => {
        datalist.append("option")
            .attr("value", lecturer)
    })

    const attributeSelect = d3.select("#search_input")

    attributeSelect.on('input', function(e) {
        //if (e.key === 'Enter') {
        let input = d3.select("#search_input").property("value")
        if (lecturers.has(input))
            make_selection(input)
            //}
    });

    const graphData = genGraphData()

    // SVG
    links = graphData.links.map(d => Object.create(d));
    nodes = graphData.nodes.map(d => Object.create(d));
    const forceMap = genForceMap(Array.from(faculty_colors.keys()))
    setupSim(links, nodes, forceMap);

    // fetch url search parameter for lecturer
    const urlSearchParams = new URLSearchParams(window.location.search);
    let searchParam = urlSearchParams.get('lecturer');
    if (searchParam != undefined) {
        make_selection(searchParam)
    }

});

let simulation = undefined;

function setupSim(links, nodes, forceMap) {
    simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id))
        .force("charge", d3.forceManyBody())
        .force("x", d3.forceX(d => forceMap.get(d.faculty).x))
        .force("y", d3.forceY(d => forceMap.get(d.faculty).y));

    const svg = d3.select("#lecturer_network")
        .attr("viewBox", [-width / 2, -height / 2, width, height])

    svg.call(d3.zoom()
        .extent([
            [0, 0],
            [width, height]
        ])
        .scaleExtent([1, 8])
        .on("zoom", zoomed));

    zoom = svg.append("g")

    const link = zoom.append("g")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke-width", d => Math.sqrt(d.value));

    const node = zoom.append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => 5 + parseInt(Math.log(d.group) / Math.log(1.5)))
        .attr("fill", d => lecturer_selected ? "LightGray" : faculty_colors.get(d.faculty))
        .call(drag(simulation))
        .on("mouseover", hoverLecturer)
        .on("mouseout", unhoverLecturer)
        .on("click", clickLecturer);

    node.append("title")
        .text(d => d.id);

    simulation.on("tick", () => {
        link.attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node.attr("cx", d => d.x)
            .attr("cy", d => d.y);
    });
}

function hoverLecturer(e) {
    d3.select(this).attr("r", d => 5 + parseInt(Math.log(d.group) / Math.log(1.5))).style("fill", d => {
        lecturer_selected = true
        lecturer_selected_name = d.id
        redraw()
        return (d.id == lecturer_force_selected_name) ? "red" : faculty_colors.get(d.faculty)
    });
}

function unhoverLecturer(e) {
    d3.select(this).attr("r", d => 5 + parseInt(Math.log(d.group) / Math.log(1.5))).style("fill", d => {
        lecturer_selected = false
        lecturer_selected_name = ""
        redraw()
        return faculty_colors.get(lecturer_selected ? "LightGray" : faculty_colors.get(d.faculty))
    });
}

function clickLecturer(e, d) {
    if (lecturer_force_selected_name == d.id) {
        remove_selection()
        d3.select(this).style("fill", faculty_colors.get(d.faculty))
    } else {
        make_selection(d.id)
        d3.select(this).style("fill", "red")
    }
}

function zoomed({ transform }) {
    zoom.attr("transform", transform);
    zoom.transition()
        .duration(3750)
}

function genForceMap(faculties) {
    const radius = 100;
    const numFaculties = faculties.length;
    const forceMap = new Map();

    faculties.forEach((faculty, index) => {
        if (faculty === "Sonstiges") {
            forceMap.set(faculty, { x: 0, y: 0 })
        } else {
            const phi = 2 * Math.PI / numFaculties * index;
            forceMap.set(faculty, {
                x: radius * Math.cos(phi),
                y: radius * Math.sin(phi) });
        }
    });
    return forceMap;
}

// function to redraw the graph on mouseover event
function redraw() {
    zoom.selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => 5 + parseInt(Math.log(d.group) / Math.log(1.5)))
        .attr("stroke", d => (lecturer_selected && lecturer_selected_name == d.id) ?
            "red" :
            "white")
        .attr("stroke-width", d => (lecturer_selected && lecturer_selected_name == d.id) ?
            3 :
            2)
        .attr("fill", d => {
            if (!force_selection) {
                if (lecturer_selected && !is_connected(lecturer_selected_name, d.id)) {
                    return "LightGray";
                } else {
                    return faculty_colors.get(d.faculty);
                }
            } else {
                if (d.id == lecturer_force_selected_name) {
                    return "red";
                } else if (is_connected(lecturer_force_selected_name, d.id)) {
                    return faculty_colors.get(d.faculty);
                } else {
                    return "LightGray";
                }
            }
        })
        .call(drag(simulation))
}

let drag = simulation => {
    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    }

    function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

function select_teacher() {
    zoom.selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", d => 5 + parseInt(Math.log(d.group) / Math.log(1.5)))
        .attr("fill", d => (lecturer_selected && !is_connected(lecturer_selected_name, d.id)) ? lecturer_selected_name == d.id ? "red" : "LightGray" : faculty_colors.get(d.faculty))
        .call(drag(simulation))
}

function remove_selection() {
    force_selection = false
    lecturer_selected = false
    lecturer_selected_name = ""
    lecturer_force_selected_name = ""
    d3.select("#tip").select("div").remove()
    d3.select("#search_input").property("value", "")
    d3.select("#description").text("Diese Visualisierung zeigt die Lehrenden der Bauhaus-Universität und ihre gemeinsamen Veranstaltungen im aktuellen Semester.")
}


function make_selection(input) {
    let description = d3.select("#description").text("")
    description.append("c").text("Diese Visualisierung zeigt die Lehrperson ")
    description.append("strong").text(input)
    description.append("c").text(" und alle Lehrpersonen mit gemeinsamen Kursen im aktuellen Semester.")

    selector_url.searchParams.set("lecturer", input)
    d3.select("#tip").select("div").remove()
    let tip = description //d3.select("#tip").append("div").text("")
    tip.append("c").text(" (")
    tip.append("a").attr("href", selector_url).text("Erfahre mehr über die Veranstaltungen von " + input)
    tip.append("c").text(")")
    d3.select("#search_input").property("value", input)

    lecturer_selected_name = input;
    lecturer_selected = true

    force_selection = true
    lecturer_force_selected_name = input

    select_teacher()
}

//function to test if two nodes are connected:
function is_connected(lecturer_A_name, lecturer_B_name) {
    return lecturers.get(lecturer_A_name).colecturers.has(lecturer_B_name)
}
